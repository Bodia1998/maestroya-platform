import { formatScaledDecimal, parseScaledDecimal } from "@/domain/services/fixed-point-decimal";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";

/**
 * Module 163 — Structured scope questionnaire. Pure, deterministic, no I/O.
 *
 * Answers ONE question: "given a category's released questionnaire definition
 * and the customer's answers, are the answers valid, and which scope /
 * complexity factors do they select?" It does not price anything and does not
 * estimate anything: the factors it returns are handed to the Module 129
 * estimator (`context.structuredScope`), which stays the only place that
 * multiplies them into a value and enforces the ceiling.
 *
 * Data, not code. A questionnaire is an explicit, versioned definition per
 * category slug. THIS FILE SHIPS NO QUESTIONNAIRE AND NO FACTOR TABLE: the
 * category-by-category factor tables are a business decision (D3 / D21 / D4
 * are not recorded as approved), so the active registry
 * (infrastructure/pricing/lead-scope-questionnaires.v1.ts) is empty and every
 * lookup is NOT_CONFIGURED (fail closed => the unchanged Module 129 behaviour).
 *
 * Honest inputs only. Answers are structured values (an allowed option or a
 * bounded integer). Free text is never accepted or parsed, and the customer's
 * stated budget is not an input of anything here: the answer type has no such
 * field and an unknown question id is rejected, so it cannot be smuggled in.
 *
 * Answers can only raise PRECISION, never bypass limits:
 *   - every factor is a fixed-point value in (0, MAX_FACTOR];
 *   - a definition is valid only if the product of the LARGEST factor of every
 *     question (the worst case any answer set can reach) stays within the
 *     definition's declared `maxScopeFactor` / `maxComplexityFactor`, so no
 *     tampered answer can exceed them (checked statically, not clamped);
 *   - the estimator still applies its own ceiling afterwards, and the Lead
 *     pricing engine its own min/max price.
 *
 * Money: none here. Factors are fixed-point with 6 fraction digits (bigint);
 * the product of all factors is exact and rounded ONCE, half-up.
 */

export const SCOPE_FACTOR_SCALE_DIGITS = 6;
const FIXED_ONE = 1_000_000n;
/** Same bound as the Module 129 estimator / Module 132 contract: 10.0. */
const MAX_FACTOR = 10n * FIXED_ONE;

export const SCOPE_QUESTION_KINDS = ["SINGLE_CHOICE", "INTEGER_RANGE"] as const;
export type ScopeQuestionKind = (typeof SCOPE_QUESTION_KINDS)[number];

const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const OPTION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 30;
const MAX_BANDS = 30;
const MAX_INTEGER_BOUND = 1_000_000;

interface QuestionBase {
  /** Stable machine id, e.g. "surface_band". Never shown as a label; i18n keys derive from it. */
  id: string;
  /** Required questions must be answered or the whole answer set is INVALID. */
  required: boolean;
}

export interface ScopeChoiceOption {
  /** Stable machine value, e.g. "up_to_10m2". */
  value: string;
  /** Fixed-point decimal string ("1.0" = neutral). */
  scopeFactor: string;
  complexityFactor: string;
}

export interface ScopeSingleChoiceQuestion extends QuestionBase {
  kind: "SINGLE_CHOICE";
  options: readonly ScopeChoiceOption[];
}

export interface ScopeIntegerBand {
  /** Inclusive upper bound of the band. Bands are ascending; the last must equal `max`. */
  upTo: number;
  scopeFactor: string;
  complexityFactor: string;
}

export interface ScopeIntegerRangeQuestion extends QuestionBase {
  kind: "INTEGER_RANGE";
  /** Inclusive integer bounds an answer must fall in. */
  min: number;
  max: number;
  bands: readonly ScopeIntegerBand[];
}

export type ScopeQuestion = ScopeSingleChoiceQuestion | ScopeIntegerRangeQuestion;

/** Two answers that cannot both be true (e.g. "studio flat" + "6 rooms"). Both must match for the pair to be contradictory. */
export interface ScopeContradiction {
  a: { questionId: string; value: string | number };
  b: { questionId: string; value: string | number };
}

export interface ScopeQuestionnaireDefinition {
  /** Stored with every estimate built from it. Never edit a released definition in place: add a new version. */
  questionnaireVersion: string;
  /** ServiceCategory.slug the questionnaire applies to. */
  categorySlug: string;
  questions: readonly ScopeQuestion[];
  contradictions?: readonly ScopeContradiction[];
  /** Upper bound the combined scope factor can ever reach (fixed-point decimal string). */
  maxScopeFactor: string;
  /** Upper bound the combined complexity factor can ever reach. */
  maxComplexityFactor: string;
}

// ---------------------------------------------------------------------------
// Definition validation
// ---------------------------------------------------------------------------

export type ScopeDefinitionIssueCode =
  | "MALFORMED"
  | "INVALID_VERSION"
  | "INVALID_CATEGORY"
  | "NO_QUESTIONS"
  | "NO_REQUIRED_QUESTION"
  | "TOO_MANY"
  | "DUPLICATE_ID"
  | "INVALID_ID"
  | "INVALID_FACTOR"
  | "INVALID_RANGE"
  | "INVALID_BANDS"
  | "INVALID_OPTIONS"
  | "INVALID_CONTRADICTION"
  | "MAX_FACTOR_EXCEEDED";

export interface ScopeDefinitionIssue {
  code: ScopeDefinitionIssueCode;
  path: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const parseFactor = (raw: unknown): bigint | null => {
  const f = parseScaledDecimal(raw, SCOPE_FACTOR_SCALE_DIGITS);
  return f === null || f <= 0n || f > MAX_FACTOR ? null : f;
};

interface CompiledChoice {
  kind: "SINGLE_CHOICE";
  id: string;
  required: boolean;
  options: Map<string, { scope: bigint; complexity: bigint }>;
}
interface CompiledRange {
  kind: "INTEGER_RANGE";
  id: string;
  required: boolean;
  min: number;
  max: number;
  bands: { upTo: number; scope: bigint; complexity: bigint }[];
}
type CompiledQuestion = CompiledChoice | CompiledRange;

interface CompiledDefinition {
  questionnaireVersion: string;
  categorySlug: string;
  questions: CompiledQuestion[];
  contradictions: { a: { id: string; value: string | number }; b: { id: string; value: string | number } }[];
}

const isBoundInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= -MAX_INTEGER_BOUND && n <= MAX_INTEGER_BOUND;

function compileDefinition(raw: unknown, issues: ScopeDefinitionIssue[]): CompiledDefinition | null {
  const bad = (code: ScopeDefinitionIssueCode, path: string) => void issues.push({ code, path });
  if (!isRecord(raw)) {
    bad("MALFORMED", "");
    return null;
  }
  const { questionnaireVersion, categorySlug, questions, contradictions } = raw;
  if (typeof questionnaireVersion !== "string" || !VERSION_PATTERN.test(questionnaireVersion)) bad("INVALID_VERSION", "questionnaireVersion");
  if (typeof categorySlug !== "string" || !VERSION_PATTERN.test(categorySlug)) bad("INVALID_CATEGORY", "categorySlug");
  const maxScope = parseFactor(raw.maxScopeFactor);
  const maxComplexity = parseFactor(raw.maxComplexityFactor);
  if (maxScope === null) bad("INVALID_FACTOR", "maxScopeFactor");
  if (maxComplexity === null) bad("INVALID_FACTOR", "maxComplexityFactor");

  if (!Array.isArray(questions) || questions.length === 0) {
    bad("NO_QUESTIONS", "questions");
    return null;
  }
  if (questions.length > MAX_QUESTIONS) {
    bad("TOO_MANY", "questions");
    return null;
  }

  const compiled: CompiledQuestion[] = [];
  const seen = new Set<string>();
  // Largest factor each question can contribute; their single-rounding product is the worst case any answers can reach.
  const worstScopeFactors: bigint[] = [];
  const worstComplexityFactors: bigint[] = [];

  questions.forEach((q: unknown, i) => {
    const path = `questions[${i}]`;
    if (!isRecord(q)) return bad("MALFORMED", path);
    const id = q.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return bad("INVALID_ID", `${path}.id`);
    if (seen.has(id)) return bad("DUPLICATE_ID", `${path}.id`);
    seen.add(id);
    if (typeof q.required !== "boolean") return bad("MALFORMED", `${path}.required`);

    if (q.kind === "SINGLE_CHOICE") {
      const opts = q.options;
      if (!Array.isArray(opts) || opts.length === 0 || opts.length > MAX_OPTIONS) return bad("INVALID_OPTIONS", `${path}.options`);
      const map = new Map<string, { scope: bigint; complexity: bigint }>();
      let maxS = 0n;
      let maxC = 0n;
      for (const [j, o] of opts.entries()) {
        const op = `${path}.options[${j}]`;
        if (!isRecord(o) || typeof o.value !== "string" || !OPTION_PATTERN.test(o.value) || map.has(o.value)) {
          bad("INVALID_OPTIONS", op);
          continue;
        }
        const s = parseFactor(o.scopeFactor);
        const c = parseFactor(o.complexityFactor);
        if (s === null || c === null) {
          bad("INVALID_FACTOR", op);
          continue;
        }
        map.set(o.value, { scope: s, complexity: c });
        if (s > maxS) maxS = s;
        if (c > maxC) maxC = c;
      }
      if (map.size !== opts.length) return;
      // An optional question that is skipped contributes neutral 1.0, so the worst case is max(option, 1.0).
      const wS = q.required ? maxS : maxS > FIXED_ONE ? maxS : FIXED_ONE;
      const wC = q.required ? maxC : maxC > FIXED_ONE ? maxC : FIXED_ONE;
      worstScopeFactors.push(wS);
      worstComplexityFactors.push(wC);
      compiled.push({ kind: "SINGLE_CHOICE", id, required: q.required, options: map });
      return;
    }

    if (q.kind === "INTEGER_RANGE") {
      const { min, max, bands } = q;
      if (!isBoundInt(min) || !isBoundInt(max) || min > max) return bad("INVALID_RANGE", path);
      if (!Array.isArray(bands) || bands.length === 0 || bands.length > MAX_BANDS) return bad("INVALID_BANDS", `${path}.bands`);
      const out: CompiledRange["bands"] = [];
      let prev = min - 1;
      let maxS = 0n;
      let maxC = 0n;
      let ok = true;
      for (const [j, b] of bands.entries()) {
        const bp = `${path}.bands[${j}]`;
        if (!isRecord(b) || !isBoundInt(b.upTo) || b.upTo <= prev || b.upTo > max) {
          bad("INVALID_BANDS", bp);
          ok = false;
          continue;
        }
        const s = parseFactor(b.scopeFactor);
        const c = parseFactor(b.complexityFactor);
        if (s === null || c === null) {
          bad("INVALID_FACTOR", bp);
          ok = false;
          continue;
        }
        prev = b.upTo;
        out.push({ upTo: b.upTo, scope: s, complexity: c });
        if (s > maxS) maxS = s;
        if (c > maxC) maxC = c;
      }
      // The bands must cover the whole range, so every in-range answer has exactly one band.
      if (ok && prev !== max) {
        bad("INVALID_BANDS", `${path}.bands`);
        ok = false;
      }
      if (!ok) return;
      const wS = q.required ? maxS : maxS > FIXED_ONE ? maxS : FIXED_ONE;
      const wC = q.required ? maxC : maxC > FIXED_ONE ? maxC : FIXED_ONE;
      worstScopeFactors.push(wS);
      worstComplexityFactors.push(wC);
      compiled.push({ kind: "INTEGER_RANGE", id, required: q.required, min, max, bands: out });
      return;
    }

    bad("MALFORMED", `${path}.kind`);
  });

  const compiledContradictions: CompiledDefinition["contradictions"] = [];
  if (contradictions !== undefined) {
    if (!Array.isArray(contradictions) || contradictions.length > 100) bad("INVALID_CONTRADICTION", "contradictions");
    else {
      contradictions.forEach((c: unknown, i) => {
        const path = `contradictions[${i}]`;
        const side = (s: unknown): { id: string; value: string | number } | null => {
          if (!isRecord(s) || typeof s.questionId !== "string" || !seen.has(s.questionId)) return null;
          if (typeof s.value !== "string" && !(typeof s.value === "number" && Number.isSafeInteger(s.value))) return null;
          return { id: s.questionId, value: s.value };
        };
        const a = isRecord(c) ? side(c.a) : null;
        const b = isRecord(c) ? side(c.b) : null;
        if (!a || !b || a.id === b.id) return bad("INVALID_CONTRADICTION", path);
        compiledContradictions.push({ a, b });
      });
    }
  }

  // A definition with no required question could "validate" an empty answer set: it carries no information about the job.
  if (issues.length === 0 && !compiled.some((q) => q.required)) bad("NO_REQUIRED_QUESTION", "questions");
  if (issues.length > 0 || maxScope === null || maxComplexity === null) return null;
  // Static worst case: no answer set can ever exceed the declared maxima.
  const worstScope = multiplyFactors(worstScopeFactors);
  const worstComplexity = multiplyFactors(worstComplexityFactors);
  if (worstScope > maxScope) bad("MAX_FACTOR_EXCEEDED", "maxScopeFactor");
  if (worstComplexity > maxComplexity) bad("MAX_FACTOR_EXCEEDED", "maxComplexityFactor");
  if (issues.length > 0) return null;

  return {
    questionnaireVersion: questionnaireVersion as string,
    categorySlug: categorySlug as string,
    questions: compiled,
    contradictions: compiledContradictions,
  };
}

/** Every problem of a candidate definition (empty = usable). */
export function validateScopeQuestionnaireDefinition(candidate: unknown): readonly ScopeDefinitionIssue[] {
  const issues: ScopeDefinitionIssue[] = [];
  compileDefinition(candidate, issues);
  return issues;
}

export function isValidScopeQuestionnaireDefinition(candidate: unknown): candidate is ScopeQuestionnaireDefinition {
  return validateScopeQuestionnaireDefinition(candidate).length === 0;
}

// ---------------------------------------------------------------------------
// Answer evaluation
// ---------------------------------------------------------------------------

export type ScopeAnswerIssueCode =
  | "INVALID_DEFINITION"
  | "ANSWERS_MALFORMED"
  | "UNKNOWN_QUESTION"
  | "MISSING_REQUIRED"
  | "INVALID_TYPE"
  | "VALUE_NOT_ALLOWED"
  | "OUT_OF_RANGE"
  | "CONTRADICTORY_ANSWERS";

export interface ScopeAnswerIssue {
  code: ScopeAnswerIssueCode;
  /** Question id; null for whole-answer-set problems. */
  questionId: string | null;
}

export type ScopeAnswerValue = string | number;

export type ScopeAnswersEvaluation =
  | {
      status: "VALID";
      questionnaireVersion: string;
      categorySlug: string;
      /** Canonical answers (definition order, only answered questions) — what to store and what reproduces the factors. */
      answers: Readonly<Record<string, ScopeAnswerValue>>;
      /** Fixed-point decimal strings ("1.0" = neutral). */
      scopeFactor: string;
      complexityFactor: string;
    }
  | { status: "INVALID"; issues: readonly ScopeAnswerIssue[] };

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Half-up rounded product of fixed-point factors, rounded ONCE. */
function multiplyFactors(factors: readonly bigint[]): bigint {
  if (factors.length === 0) return FIXED_ONE;
  const numerator = factors.reduce((acc, f) => acc * f, 1n);
  const denominator = FIXED_ONE ** BigInt(factors.length - 1);
  return (numerator * 2n + denominator) / (2n * denominator);
}

const fmt = (f: bigint) => formatScaledDecimal(f, SCOPE_FACTOR_SCALE_DIGITS, 1);

/**
 * Validates the answers against a definition and derives the combined factors.
 * Never throws and never guesses: any problem is INVALID with every reason
 * found. A VALID result implies every required question was answered.
 */
export function evaluateScopeAnswers(definition: ScopeQuestionnaireDefinition, answers: unknown): ScopeAnswersEvaluation {
  const defIssues: ScopeDefinitionIssue[] = [];
  const compiled = compileDefinition(definition, defIssues);
  if (!compiled) return { status: "INVALID", issues: [{ code: "INVALID_DEFINITION", questionId: null }] };
  if (!isRecord(answers) || (Object.getPrototypeOf(answers) !== Object.prototype && Object.getPrototypeOf(answers) !== null)) {
    return { status: "INVALID", issues: [{ code: "ANSWERS_MALFORMED", questionId: null }] };
  }

  const issues: ScopeAnswerIssue[] = [];
  const known = new Set(compiled.questions.map((q) => q.id));
  for (const key of Object.keys(answers)) if (!known.has(key)) issues.push({ code: "UNKNOWN_QUESTION", questionId: key });

  const canonical: Record<string, ScopeAnswerValue> = {};
  const scopeFactors: bigint[] = [];
  const complexityFactors: bigint[] = [];

  for (const q of compiled.questions) {
    const provided = hasOwn(answers, q.id) ? answers[q.id] : undefined;
    if (provided === undefined || provided === null) {
      if (q.required) issues.push({ code: "MISSING_REQUIRED", questionId: q.id });
      continue; // an unanswered optional question is neutral
    }
    if (q.kind === "SINGLE_CHOICE") {
      if (typeof provided !== "string") {
        issues.push({ code: "INVALID_TYPE", questionId: q.id });
        continue;
      }
      const option = q.options.get(provided);
      if (!option) {
        issues.push({ code: "VALUE_NOT_ALLOWED", questionId: q.id });
        continue;
      }
      canonical[q.id] = provided;
      scopeFactors.push(option.scope);
      complexityFactors.push(option.complexity);
    } else {
      if (typeof provided !== "number" || !Number.isSafeInteger(provided)) {
        issues.push({ code: "INVALID_TYPE", questionId: q.id });
        continue;
      }
      if (provided < q.min || provided > q.max) {
        issues.push({ code: "OUT_OF_RANGE", questionId: q.id });
        continue;
      }
      const band = q.bands.find((b) => provided <= b.upTo);
      if (!band) {
        issues.push({ code: "OUT_OF_RANGE", questionId: q.id });
        continue;
      }
      canonical[q.id] = provided;
      scopeFactors.push(band.scope);
      complexityFactors.push(band.complexity);
    }
  }

  for (const c of compiled.contradictions) {
    if (canonical[c.a.id] === c.a.value && canonical[c.b.id] === c.b.value) {
      issues.push({ code: "CONTRADICTORY_ANSWERS", questionId: c.a.id });
    }
  }

  if (issues.length > 0) return { status: "INVALID", issues };
  return {
    status: "VALID",
    questionnaireVersion: compiled.questionnaireVersion,
    categorySlug: compiled.categorySlug,
    answers: Object.freeze(canonical),
    scopeFactor: fmt(multiplyFactors(scopeFactors)),
    complexityFactor: fmt(multiplyFactors(complexityFactors)),
  };
}

// ---------------------------------------------------------------------------
// Registry lookup + hand-off to the estimator
// ---------------------------------------------------------------------------

export type ScopeQuestionnaireRegistry = Readonly<Record<string, ScopeQuestionnaireDefinition>>;

/** The trusted, server-derived scope handed to the estimator. Never built from raw client input. */
export interface DerivedStructuredScope {
  questionnaireVersion: string;
  scopeFactor: string;
  complexityFactor: string;
}

export type StructuredScopeDerivation =
  | { status: "STRUCTURED"; structuredScope: DerivedStructuredScope; answers: Readonly<Record<string, ScopeAnswerValue>> }
  /** No scope information is used; the estimate stays exactly what Module 129 produces without it. */
  | { status: "NOT_APPLICABLE"; reason: "NOT_LEAD_V1" | "QUESTIONNAIRE_NOT_CONFIGURED" | "NO_ANSWERS" }
  /** A questionnaire exists but the answers cannot be used. Entry points must refuse the submission; estimation falls back to NOT_APPLICABLE semantics. */
  | { status: "REJECTED"; issues: readonly ScopeAnswerIssue[] };

/**
 * LEAD_V1 entry point for the customer submission: the flow is fixed here (domain-side), so a caller that merely delegates to the
 * Lead Marketplace use case never needs to name the flow itself.
 */
export function deriveLeadV1StructuredScope(
  registry: ScopeQuestionnaireRegistry,
  category: { categorySlug: string | null; parentCategorySlug: string | null },
  answers: unknown,
): StructuredScopeDerivation {
  return deriveStructuredScope(registry, { flowVersion: LEAD_FLOW_VERSION, ...category }, answers);
}

export interface ScopeCategoryRef {
  flowVersion: string | null | undefined;
  categorySlug: string | null;
  parentCategorySlug: string | null;
}

/**
 * Own-slug-then-parent questionnaire lookup (same rule as Modules 128/129/142),
 * then answer evaluation. LEAD_V1 only: any other flow never uses structured
 * scope. An absent registry entry is "not configured", never an error and never
 * a default questionnaire.
 */
export function deriveStructuredScope(
  registry: ScopeQuestionnaireRegistry,
  category: ScopeCategoryRef,
  answers: unknown,
): StructuredScopeDerivation {
  if (!category || category.flowVersion !== LEAD_FLOW_VERSION) return { status: "NOT_APPLICABLE", reason: "NOT_LEAD_V1" };
  const definition = findScopeQuestionnaire(registry, category.categorySlug, category.parentCategorySlug);
  if (!definition) return { status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" };
  if (answers === undefined || answers === null) return { status: "NOT_APPLICABLE", reason: "NO_ANSWERS" };

  const evaluation = evaluateScopeAnswers(definition, answers);
  if (evaluation.status !== "VALID") return { status: "REJECTED", issues: evaluation.issues };
  return {
    status: "STRUCTURED",
    structuredScope: {
      questionnaireVersion: evaluation.questionnaireVersion,
      scopeFactor: evaluation.scopeFactor,
      complexityFactor: evaluation.complexityFactor,
    },
    answers: evaluation.answers,
  };
}

// ---------------------------------------------------------------------------
// Stored provenance (request row and publication snapshot)
// ---------------------------------------------------------------------------

/** Canonical, validated answers plus the questionnaire version they were validated against. This is what is persisted. */
export interface LeadScopeProvenance {
  questionnaireVersion: string;
  answers: Readonly<Record<string, ScopeAnswerValue>>;
}

export function isScopeQuestionnaireVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

/**
 * Structural check of persisted answers (defence in depth: values were already
 * validated against a definition when written). Plain object, 1..MAX_QUESTIONS
 * keys with the question-id shape, and only option-shaped strings or bounded
 * safe integers as values — never free text, nested objects or floats.
 */
export function isStoredScopeAnswers(value: unknown): value is Readonly<Record<string, ScopeAnswerValue>> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > MAX_QUESTIONS) return false;
  return keys.every((k) => {
    const v = value[k];
    return ID_PATTERN.test(k) && ((typeof v === "string" && OPTION_PATTERN.test(v)) || isBoundInt(v));
  });
}

export function isLeadScopeProvenance(value: unknown): value is LeadScopeProvenance {
  return isRecord(value) && isScopeQuestionnaireVersion(value.questionnaireVersion) && isStoredScopeAnswers(value.answers);
}

// ---------------------------------------------------------------------------
// Customer-facing view (no factors)
// ---------------------------------------------------------------------------

export type ScopeQuestionView =
  | { id: string; kind: "SINGLE_CHOICE"; required: boolean; options: readonly string[] }
  | { id: string; kind: "INTEGER_RANGE"; required: boolean; min: number; max: number };

/** What the browser may know about a questionnaire: ids, kinds, allowed values and ranges. Factors never leave the server. */
export interface ScopeQuestionnaireView {
  questionnaireVersion: string;
  categorySlug: string;
  questions: readonly ScopeQuestionView[];
}

/** Returns null for an invalid definition (nothing is offered — fail closed). */
export function toScopeQuestionnaireView(definition: ScopeQuestionnaireDefinition): ScopeQuestionnaireView | null {
  if (!isValidScopeQuestionnaireDefinition(definition)) return null;
  return {
    questionnaireVersion: definition.questionnaireVersion,
    categorySlug: definition.categorySlug,
    questions: definition.questions.map((q) =>
      q.kind === "SINGLE_CHOICE"
        ? { id: q.id, kind: q.kind, required: q.required, options: q.options.map((o) => o.value) }
        : { id: q.id, kind: q.kind, required: q.required, min: q.min, max: q.max },
    ),
  };
}

/** Same own-slug-then-parent rule as `deriveStructuredScope`, for callers that only need the definition. */
export function findScopeQuestionnaire(
  registry: ScopeQuestionnaireRegistry,
  categorySlug: string | null,
  parentCategorySlug: string | null,
): ScopeQuestionnaireDefinition | null {
  const own = typeof categorySlug === "string" && hasOwn(registry, categorySlug) ? registry[categorySlug] : undefined;
  const parent = typeof parentCategorySlug === "string" && hasOwn(registry, parentCategorySlug) ? registry[parentCategorySlug] : undefined;
  return own ?? parent ?? null;
}
