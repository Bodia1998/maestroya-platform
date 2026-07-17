/**
 * App-wide constants with no business meaning of their own (route paths,
 * pagination defaults, etc). Domain-specific constants (e.g. allowed
 * service categories) belong in that domain module once it exists, not
 * here.
 */
export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  dashboard: "/dashboard",
} as const;

export const DEFAULT_PAGE_SIZE = 20;
