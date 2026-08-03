// Module 29 — Internationalization.
//
// Retired: server-side locale/translation resolution now goes through
// real `next-intl` — `getTranslations()`/`getLocale()`/`getMessages()`/
// `getFormatter()` from `next-intl/server`, configured by
// `src/i18n/request.ts` (which contains this file's former DB/cookie/
// Accept-Language resolution logic, now wired into next-intl's
// `getRequestConfig`). Nothing in this codebase imports this file
// anymore.
//
// The file could not be removed from disk in this environment (the
// sandbox denied the delete-file permission), so it is left as this
// empty stub rather than with its former (now-unused, now-misleading)
// implementation. Safe to delete by hand once file deletion is possible.
export {};
