import { describe, expect, it } from "vitest";

import {
  deriveLeadV1StructuredScope,
  deriveStructuredScope,
  evaluateScopeAnswers,
  findScopeQuestionnaire,
  isLeadScopeProvenance,
  toScopeQuestionnaireView,
  isValidScopeQuestionnaireDefinition,
  validateScopeQuestionnaireDefinition,
  type ScopeQuestionnaireDefinition,
  type ScopeQuestionnaireRegistry,
} from "@/domain/services/lead-scope-questionnaire";
import { LEAD_SCOPE_QUESTIONNAIRES_V1 } from "@/infrastructure/pricing/lead-scope-questionnaires.v1";

/**
 * Module 163 — questionnaire validation and factor derivation. The definition
 * below is a TEST FIXTURE with arbitrary numbers; it is not a factor table the
 * business approved and it is never imported by production code.
 */
const DEF: ScopeQuestionnaireDefinition = {
  questionnaireVersion: "test-scope-v1",
  categorySlug: "pintura",
  maxScopeFactor: "4.0",
  maxComplexityFactor: "3.0",
  questions: [
    {
      id: "surface",
      required: true,
      kind: "INTEGER_RANGE",
      min: 1,
      max: 100,
      bands: [
        { upTo: 10, scopeFactor: "1.0", complexityFactor: "1.0" },
        { upTo: 40, scopeFactor: "1.5", complexityFactor: "1.0" },
        { upTo: 100, scopeFactor: "2.5", complexityFactor: "1.2" },
      ],
    },
    {
      id: "finish",
      required: true,
      kind: "SINGLE_CHOICE",
      options: [
        { value: "basic", scopeFactor: "1.0", complexityFactor: "1.0" },
        { value: "premium", scopeFactor: "1.2", complexityFactor: "1.3" },
      ],
    },
    {
      id: "access",
      required: false,
      kind: "SINGLE_CHOICE",
      options: [
        { value: "easy", scopeFactor: "1.0", complexityFactor: "1.0" },
        { value: "hard", scopeFactor: "1.0", complexityFactor: "1.5" },
      ],
    },
    {
      id: "rooms",
      required: false,
      kind: "INTEGER_RANGE",
      min: 1,
      max: 10,
      bands: [{ upTo: 10, scopeFactor: "1.0", complexityFactor: "1.0" }],
    },
  ],
  contradictions: [{ a: { questionId: "surface", value: 1 }, b: { questionId: "rooms", value: 10 } }],
};

const valid = { surface: 25, finish: "premium" };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const issuesOf = (r: ReturnType<typeof evaluateScopeAnswers>) => (r.status === "INVALID" ? r.issues.map((i) => `${i.code}:${i.questionId}`) : []);

describe("evaluateScopeAnswers — valid answers", () => {
  it("derives exact fixed-point factors and canonical answers", () => {
    const r = evaluateScopeAnswers(DEF, valid);
    expect(r).toEqual({
      status: "VALID",
      questionnaireVersion: "test-scope-v1",
      categorySlug: "pintura",
      answers: { surface: 25, finish: "premium" },
      scopeFactor: "1.8", // 1.5 x 1.2
      complexityFactor: "1.3", // 1.0 x 1.3
    });
  });

  it("optional answers refine the factors; an unanswered optional question is neutral", () => {
    const r = evaluateScopeAnswers(DEF, { ...valid, access: "hard" });
    expect(r).toMatchObject({ status: "VALID", scopeFactor: "1.8", complexityFactor: "1.95" }); // 1.3 x 1.5
    expect(evaluateScopeAnswers(DEF, { ...valid, access: null })).toMatchObject({ status: "VALID", complexityFactor: "1.3" });
  });

  it("is deterministic and independent of the key order of the answers", () => {
    const a = evaluateScopeAnswers(DEF, { surface: 25, finish: "premium", access: "easy" });
    const b = evaluateScopeAnswers(DEF, { access: "easy", finish: "premium", surface: 25 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(evaluateScopeAnswers(DEF, valid))).toBe(JSON.stringify(evaluateScopeAnswers(DEF, valid)));
  });

  it("does not mutate the input answers or the definition", () => {
    const answers = Object.freeze({ ...valid });
    const frozenDef = clone(DEF);
    const before = JSON.stringify(frozenDef);
    evaluateScopeAnswers(frozenDef, answers);
    expect(JSON.stringify(frozenDef)).toBe(before);
  });

  it.each([
    [1, "1.0"],
    [10, "1.0"],
    [11, "1.5"],
    [40, "1.5"],
    [41, "2.5"],
    [100, "2.5"],
  ])("band boundary: surface %i -> scope factor %s (finish basic)", (surface, expected) => {
    expect(evaluateScopeAnswers(DEF, { surface, finish: "basic" })).toMatchObject({ status: "VALID", scopeFactor: expected });
  });
});

describe("evaluateScopeAnswers — rejected answers", () => {
  it("missing required answers are INVALID, never defaulted", () => {
    expect(issuesOf(evaluateScopeAnswers(DEF, {}))).toEqual(["MISSING_REQUIRED:surface", "MISSING_REQUIRED:finish"]);
    expect(issuesOf(evaluateScopeAnswers(DEF, { surface: 5 }))).toEqual(["MISSING_REQUIRED:finish"]);
    expect(issuesOf(evaluateScopeAnswers(DEF, { surface: 5, finish: null }))).toEqual(["MISSING_REQUIRED:finish"]);
  });

  it("unknown questions are rejected — including anything shaped like a budget, price or free text", () => {
    for (const key of ["budgetMin", "budgetMax", "budget", "estimatedServiceValue", "price", "notes", "__proto__x"]) {
      expect(issuesOf(evaluateScopeAnswers(DEF, { ...valid, [key]: 100 }))).toEqual([`UNKNOWN_QUESTION:${key}`]);
    }
  });

  it.each([
    ["integer given as string", { surface: "25", finish: "basic" }, "INVALID_TYPE:surface"],
    ["integer given as float", { surface: 12.5, finish: "basic" }, "INVALID_TYPE:surface"],
    ["integer given as NaN", { surface: Number.NaN, finish: "basic" }, "INVALID_TYPE:surface"],
    ["integer given as Infinity", { surface: Number.POSITIVE_INFINITY, finish: "basic" }, "INVALID_TYPE:surface"],
    ["integer given as boolean", { surface: true, finish: "basic" }, "INVALID_TYPE:surface"],
    ["choice given as number", { surface: 5, finish: 1 }, "INVALID_TYPE:finish"],
    ["choice given as object", { surface: 5, finish: { value: "basic" } }, "INVALID_TYPE:finish"],
    ["choice given as array", { surface: 5, finish: ["basic"] }, "INVALID_TYPE:finish"],
    ["integer below range", { surface: 0, finish: "basic" }, "OUT_OF_RANGE:surface"],
    ["integer above range", { surface: 101, finish: "basic" }, "OUT_OF_RANGE:surface"],
    ["negative integer", { surface: -5, finish: "basic" }, "OUT_OF_RANGE:surface"],
    ["unknown option", { surface: 5, finish: "luxury" }, "VALUE_NOT_ALLOWED:finish"],
    ["option differing only by case", { surface: 5, finish: "Basic" }, "VALUE_NOT_ALLOWED:finish"],
    ["prototype key as option", { surface: 5, finish: "constructor" }, "VALUE_NOT_ALLOWED:finish"],
    ["__proto__ as option", { surface: 5, finish: "__proto__" }, "VALUE_NOT_ALLOWED:finish"],
  ])("%s", (_name, answers, expected) => {
    expect(issuesOf(evaluateScopeAnswers(DEF, answers))).toEqual([expected]);
  });

  it("contradictory answers are INVALID with an explicit reason", () => {
    expect(issuesOf(evaluateScopeAnswers(DEF, { surface: 1, finish: "basic", rooms: 10 }))).toEqual(["CONTRADICTORY_ANSWERS:surface"]);
    // The same answers one step apart are not contradictory.
    expect(evaluateScopeAnswers(DEF, { surface: 2, finish: "basic", rooms: 10 }).status).toBe("VALID");
  });

  it("collects every problem rather than stopping at the first", () => {
    expect(issuesOf(evaluateScopeAnswers(DEF, { surface: 500, finish: "luxury", x: 1 })).sort()).toEqual(
      ["OUT_OF_RANGE:surface", "UNKNOWN_QUESTION:x", "VALUE_NOT_ALLOWED:finish"].sort(),
    );
  });

  it.each([null, undefined, "x", 5, [], [["surface", 5]], new Map(), new (class A {})()])("non-plain answers object %# is ANSWERS_MALFORMED", (answers) => {
    expect(issuesOf(evaluateScopeAnswers(DEF, answers))).toEqual(["ANSWERS_MALFORMED:null"]);
  });

  it("an invalid definition never yields a VALID evaluation (fail closed)", () => {
    const broken = { ...clone(DEF), maxScopeFactor: "1.0" } as ScopeQuestionnaireDefinition;
    expect(issuesOf(evaluateScopeAnswers(broken, valid))).toEqual(["INVALID_DEFINITION:null"]);
  });
});

describe("definition validation", () => {
  it("accepts the fixture", () => {
    expect(validateScopeQuestionnaireDefinition(DEF)).toEqual([]);
    expect(isValidScopeQuestionnaireDefinition(DEF)).toBe(true);
  });

  // Deliberately loose: the tests corrupt a definition in ways its type forbids.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutate = (fn: (d: any) => void) => {
    const d = clone(DEF);
    fn(d);
    return validateScopeQuestionnaireDefinition(d).map((i) => i.code);
  };

  it.each([
    ["not an object", () => validateScopeQuestionnaireDefinition(null).map((i) => i.code), "MALFORMED"],
    ["bad version", () => mutate((d) => (d.questionnaireVersion = "Has Spaces")), "INVALID_VERSION"],
    ["bad category slug", () => mutate((d) => (d.categorySlug = "")), "INVALID_CATEGORY"],
    ["no questions", () => mutate((d) => (d.questions = [])), "NO_QUESTIONS"],
    ["too many questions", () => mutate((d) => (d.questions = Array.from({ length: 31 }, (_, i) => ({ ...d.questions[1], id: `q${i}` })))), "TOO_MANY"],
    ["duplicate question id", () => mutate((d) => (d.questions[1].id = "surface")), "DUPLICATE_ID"],
    ["invalid question id", () => mutate((d) => (d.questions[1].id = "Bad Id")), "INVALID_ID"],
    ["zero factor", () => mutate((d) => (d.questions[1].options[0].scopeFactor = "0")), "INVALID_FACTOR"],
    ["factor above 10.0", () => mutate((d) => (d.questions[1].options[0].scopeFactor = "10.000001")), "INVALID_FACTOR"],
    ["negative factor", () => mutate((d) => (d.questions[1].options[0].scopeFactor = "-1.0")), "INVALID_FACTOR"],
    ["exponent factor", () => mutate((d) => (d.questions[1].options[0].scopeFactor = "1e3")), "INVALID_FACTOR"],
    ["factor given as a number", () => mutate((d) => (d.questions[1].options[0].scopeFactor = 1.5)), "INVALID_FACTOR"],
    ["more than 6 fraction digits", () => mutate((d) => (d.questions[1].options[0].scopeFactor = "1.0000001")), "INVALID_FACTOR"],
    ["inverted range", () => mutate((d) => ((d.questions[0].min = 50), (d.questions[0].max = 10))), "INVALID_RANGE"],
    ["non-integer range bound", () => mutate((d) => (d.questions[0].max = 100.5)), "INVALID_RANGE"],
    ["bands not covering the range", () => mutate((d) => (d.questions[0].bands.pop())), "INVALID_BANDS"],
    ["bands not ascending", () => mutate((d) => (d.questions[0].bands[1].upTo = 5)), "INVALID_BANDS"],
    ["band beyond range", () => mutate((d) => (d.questions[0].bands[2].upTo = 101)), "INVALID_BANDS"],
    ["empty options", () => mutate((d) => (d.questions[1].options = [])), "INVALID_OPTIONS"],
    ["duplicate option value", () => mutate((d) => (d.questions[1].options[1].value = "basic")), "INVALID_OPTIONS"],
    ["unknown question kind", () => mutate((d) => (d.questions[1].kind = "FREE_TEXT")), "MALFORMED"],
    ["contradiction on unknown question", () => mutate((d) => (d.contradictions[0].a.questionId = "nope")), "INVALID_CONTRADICTION"],
    ["contradiction of a question with itself", () => mutate((d) => (d.contradictions[0].b.questionId = "surface")), "INVALID_CONTRADICTION"],
    ["declared maximum below the worst case (scope)", () => mutate((d) => (d.maxScopeFactor = "2.99")), "MAX_FACTOR_EXCEEDED"],
    ["declared maximum below the worst case (complexity)", () => mutate((d) => (d.maxComplexityFactor = "2.0")), "MAX_FACTOR_EXCEEDED"],
  ])("rejects: %s", (_name, run, code) => {
    expect(run()).toContain(code);
  });

  it("the declared maximum is exactly the reachable worst case (2.5 x 1.2 = 3.0; complexity 1.2 x 1.3 x 1.5 = 2.34)", () => {
    expect(mutate((d) => ((d.maxScopeFactor = "3.0"), (d.maxComplexityFactor = "2.34")))).toEqual([]);
    expect(mutate((d) => ((d.maxScopeFactor = "3.0"), (d.maxComplexityFactor = "2.339999")))).toEqual(["MAX_FACTOR_EXCEEDED"]);
  });
});

describe("tampering cannot exceed the declared maxima (exhaustive property check)", () => {
  it("over EVERY valid answer combination, factors stay within [lowest option product, declared maxima] and are monotonic in surface", () => {
    const maxScope = 4_000_000n;
    const maxComplexity = 3_000_000n;
    const parse = (s: string): bigint => {
      const [w, f = ""] = s.split(".");
      return BigInt(w + f.padEnd(6, "0"));
    };

    let count = 0;
    for (const finish of ["basic", "premium"]) {
      for (const access of [undefined, "easy", "hard"]) {
        for (const rooms of [undefined, 1, 5, 10]) {
          let previousScope = 0n;
          for (let surface = 1; surface <= 100; surface++) {
            const answers: Record<string, string | number> = { surface, finish };
            if (access) answers.access = access;
            if (rooms !== undefined) answers.rooms = rooms;
            const r = evaluateScopeAnswers(DEF, answers);
            if (surface === 1 && rooms === 10) {
              expect(r.status).toBe("INVALID"); // contradictory pair
              continue;
            }
            if (r.status !== "VALID") throw new Error(JSON.stringify(r));
            count++;
            const s = parse(r.scopeFactor);
            const c = parse(r.complexityFactor);
            expect(s).toBeGreaterThan(0n);
            expect(s).toBeLessThanOrEqual(maxScope);
            expect(c).toBeGreaterThan(0n);
            expect(c).toBeLessThanOrEqual(maxComplexity);
            expect(s >= previousScope).toBe(true); // larger surface never lowers the scope factor
            previousScope = s;
          }
        }
      }
    }
    expect(count).toBeGreaterThan(2000);
  });

  it("hostile numeric answers never pass validation", () => {
    for (const surface of [Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, -Number.MAX_VALUE, 1e21, 2 ** 53]) {
      expect(evaluateScopeAnswers(DEF, { surface, finish: "basic" }).status).toBe("INVALID");
    }
  });
});

describe("deriveStructuredScope — registry lookup and hand-off", () => {
  const registry: ScopeQuestionnaireRegistry = { pintura: DEF };
  const ref = (patch: Record<string, unknown> = {}) => ({ flowVersion: "LEAD_V1", categorySlug: "pintura", parentCategorySlug: null, ...patch });

  it("returns the trusted structured scope for valid answers", () => {
    expect(deriveStructuredScope(registry, ref(), valid)).toEqual({
      status: "STRUCTURED",
      structuredScope: { questionnaireVersion: "test-scope-v1", scopeFactor: "1.8", complexityFactor: "1.3" },
      answers: { surface: 25, finish: "premium" },
    });
  });

  it("a subcategory without its own questionnaire uses its parent's; its own wins when present", () => {
    expect(deriveStructuredScope(registry, ref({ categorySlug: "pintor", parentCategorySlug: "pintura" }), valid).status).toBe("STRUCTURED");
    const own = { ...DEF, questionnaireVersion: "test-scope-own", categorySlug: "pintor" };
    const both = deriveStructuredScope({ pintura: DEF, pintor: own }, ref({ categorySlug: "pintor", parentCategorySlug: "pintura" }), valid);
    expect(both).toMatchObject({ status: "STRUCTURED", structuredScope: { questionnaireVersion: "test-scope-own" } });
  });

  it("unsupported / unconfigured categories are NOT_APPLICABLE, not errors", () => {
    expect(deriveStructuredScope(registry, ref({ categorySlug: "reformas" }), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" });
    expect(deriveStructuredScope(registry, ref({ categorySlug: null }), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" });
    expect(deriveStructuredScope({}, ref(), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" });
  });

  it("prototype-chain slugs are never treated as registered questionnaires", () => {
    for (const slug of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(deriveStructuredScope({}, ref({ categorySlug: slug }), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" });
      expect(deriveStructuredScope({}, ref({ categorySlug: "x", parentCategorySlug: slug }), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "QUESTIONNAIRE_NOT_CONFIGURED" });
    }
  });

  it("absent answers are NOT_APPLICABLE (precision is optional); present-but-invalid answers are REJECTED", () => {
    expect(deriveStructuredScope(registry, ref(), undefined)).toEqual({ status: "NOT_APPLICABLE", reason: "NO_ANSWERS" });
    expect(deriveStructuredScope(registry, ref(), null)).toEqual({ status: "NOT_APPLICABLE", reason: "NO_ANSWERS" });
    expect(deriveStructuredScope(registry, ref(), {})).toMatchObject({ status: "REJECTED" });
    expect(deriveStructuredScope(registry, ref(), { surface: 0, finish: "x" })).toMatchObject({ status: "REJECTED" });
  });

  it.each(["LEGACY_QUOTE_PAYMENT", "", null, undefined, "lead_v1"])("flowVersion %j never uses structured scope (legacy isolation)", (flowVersion) => {
    expect(deriveStructuredScope(registry, ref({ flowVersion }), valid)).toEqual({ status: "NOT_APPLICABLE", reason: "NOT_LEAD_V1" });
  });
});

describe("shipped registry", () => {
  it("is empty and frozen: no factor table is active until the owner approves one", () => {
    expect(Object.keys(LEAD_SCOPE_QUESTIONNAIRES_V1)).toEqual([]);
    expect(Object.isFrozen(LEAD_SCOPE_QUESTIONNAIRES_V1)).toBe(true);
    expect(deriveStructuredScope(LEAD_SCOPE_QUESTIONNAIRES_V1, { flowVersion: "LEAD_V1", categorySlug: "fontaneria", parentCategorySlug: null }, valid)).toEqual({
      status: "NOT_APPLICABLE",
      reason: "QUESTIONNAIRE_NOT_CONFIGURED",
    });
  });
});

describe("Module 163 — provenance, view and publication-facing helpers", () => {
  const FIX: ScopeQuestionnaireDefinition = {
    questionnaireVersion: "test-scope-v1",
    categorySlug: "fontaneria",
    maxScopeFactor: "3.0",
    maxComplexityFactor: "2.0",
    questions: [{ id: "size", required: true, kind: "SINGLE_CHOICE", options: [{ value: "small", scopeFactor: "1.0", complexityFactor: "1.0" }, { value: "large", scopeFactor: "3.0", complexityFactor: "2.0" }] }],
  };

  it("isLeadScopeProvenance accepts only a well-formed version + flat non-empty answers", () => {
    expect(isLeadScopeProvenance({ questionnaireVersion: "v1", answers: { a: "b", n: 3 } })).toBe(true);
    for (const bad of [null, undefined, "x", {}, { questionnaireVersion: "v1" }, { questionnaireVersion: "v1", answers: {} }, { questionnaireVersion: "", answers: { a: "b" } }, { questionnaireVersion: "V 1", answers: { a: "b" } }, { questionnaireVersion: "v1", answers: { a: 1.5 } }, { questionnaireVersion: "v1", answers: { a: { b: 1 } } }, { questionnaireVersion: "v1", answers: ["x"] }]) {
      expect(isLeadScopeProvenance(bad)).toBe(false);
    }
  });

  it("the customer view exposes ids, kinds and allowed values — never factors, bands' factors or maxima", () => {
    const view = toScopeQuestionnaireView(FIX);
    expect(view).not.toBeNull();
    const json = JSON.stringify(view);
    expect(json).toContain("size");
    expect(json).toContain("large");
    expect(json).not.toMatch(/scopeFactor|complexityFactor|maxScopeFactor|maxComplexityFactor|"3\.0"|"2\.0"/);
  });

  it("findScopeQuestionnaire resolves the exact category, then the parent, and nothing else", () => {
    const registry = { fontaneria: FIX };
    expect(findScopeQuestionnaire(registry, "fontaneria", null)).toBe(FIX);
    expect(findScopeQuestionnaire(registry, "fontanero", "fontaneria")).toBe(FIX);
    expect(findScopeQuestionnaire(registry, "reformas", null)).toBeNull();
    expect(findScopeQuestionnaire({}, "fontaneria", null)).toBeNull();
  });

  it("deriveLeadV1StructuredScope is the LEAD_V1 derivation, and rejects what evaluateScopeAnswers rejects", () => {
    const registry = { fontaneria: FIX };
    const ref = { categorySlug: "fontaneria", parentCategorySlug: null };
    const ok = deriveLeadV1StructuredScope(registry, ref, { size: "large" });
    expect(ok).toMatchObject({ status: "STRUCTURED", structuredScope: { questionnaireVersion: "test-scope-v1", scopeFactor: "3.0", complexityFactor: "2.0" } });
    expect(deriveLeadV1StructuredScope(registry, ref, { size: "huge" }).status).toBe("REJECTED");
    expect(deriveLeadV1StructuredScope(registry, ref, {}).status).toBe("REJECTED");
    expect(deriveLeadV1StructuredScope({}, ref, { size: "large" }).status).not.toBe("STRUCTURED");
  });

  it("a definition with no required question is refused (an all-optional questionnaire could be 'complete' while empty)", () => {
    const issues = validateScopeQuestionnaireDefinition({ ...FIX, questions: [{ ...FIX.questions[0]!, required: false }] });
    expect(issues.some((i) => i.code === "NO_REQUIRED_QUESTION")).toBe(true);
  });

  it("the shipped registry is empty: no category accepts structured scope yet", () => {
    expect(Object.keys(LEAD_SCOPE_QUESTIONNAIRES_V1)).toEqual([]);
  });
});
