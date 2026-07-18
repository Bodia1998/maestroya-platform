import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="mt-1 text-sm text-foreground/70">Welcome back to MaestroYa.</p>
      </div>

      <LoginForm />

      <p className="text-center text-sm text-foreground/70">
        Don&apos;t have an account?{" "}
        <Link href="/auth/register" className="font-medium underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
