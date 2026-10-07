import { PRIVATE_CONTACT_FIELD_NAMES } from "@/application/dto/lead-contact.dto";

/**
 * Module 139 test helper (tests only): realistic sentinel values for customer
 * contact data plus a deep scanner. Any professional-facing response that is
 * not the M138 contact DTO must contain NONE of these values and NONE of the
 * private field names at ANY nesting depth.
 */
export const M139_SECRET_EMAIL = "m139-secret-email@example.invalid";
export const M139_SECRET_PHONE = "+34600009999";
export const M139_SECRET_ADDRESS = "M139_SECRET_ADDRESS";
export const M139_SECRET_POSTAL_CODE = "M139-99999";
export const M139_SECRET_NAME = "M139 Secret Customer Name";

export const M139_SENTINELS = [M139_SECRET_EMAIL, M139_SECRET_PHONE, M139_SECRET_ADDRESS, M139_SECRET_POSTAL_CODE, M139_SECRET_NAME] as const;

/** Every object key reachable in `value` (arrays and nested objects; Dates are leaves). */
export function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object" || value instanceof Date) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    out.add(key);
    collectKeys(child, out);
  }
  return out;
}

/**
 * Throws a descriptive Error (so `expect(() => ...).not.toThrow()` reads well)
 * if `value` contains a sentinel / extra forbidden value anywhere in its JSON
 * form, or any private contact key at any depth.
 */
export function assertNoContactLeak(value: unknown, extraForbiddenValues: readonly string[] = [], allowedKeys: readonly string[] = []): void {
  const json = JSON.stringify(value) ?? "";
  for (const secret of [...M139_SENTINELS, ...extraForbiddenValues]) {
    if (json.includes(secret)) throw new Error(`contact leak: value "${secret}" present in response`);
  }
  const keys = collectKeys(value);
  for (const name of PRIVATE_CONTACT_FIELD_NAMES) {
    if (keys.has(name) && !allowedKeys.includes(name)) throw new Error(`contact leak: private key "${name}" present in response`);
  }
}
