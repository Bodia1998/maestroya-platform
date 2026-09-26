/** `(key, { value }) => text` — the `admin.reconciliation` translator narrowed to the two duration messages. */
export type DurationTranslator = (key: "duration.ms" | "duration.seconds", values: { value: number }) => string;

/** Localized run duration: `{n} ms` under a second, otherwise seconds with one decimal. */
export function formatDuration(t: DurationTranslator, durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return t("duration.ms", { value: durationMs });
  return t("duration.seconds", { value: durationMs / 1000 });
}
