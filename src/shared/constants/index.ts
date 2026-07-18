/**
 * App-wide constants with no business meaning of their own (route paths,
 * pagination defaults, etc). Domain-specific constants (e.g. allowed
 * service categories) belong in that domain module once it exists, not
 * here.
 */
export const ROUTES = {
  home: "/",
  signIn: "/auth/login",
  signUp: "/auth/register",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",
  verifyEmail: "/auth/verify-email",
  logout: "/auth/logout",
  dashboard: "/dashboard",
} as const;

export const DEFAULT_PAGE_SIZE = 20;
