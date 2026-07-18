import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Forgot your password?</h1>
        <p className="mt-1 text-sm text-foreground/70">
          We&apos;ll email you a link to reset it.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-sm text-foreground/70">
        <Link href="/auth/login" className="font-medium underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
