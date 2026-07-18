import Link from "next/link";

import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Find trusted professionals for your home.
        </p>
      </div>

      <RegisterForm />

      <p className="text-center text-sm text-foreground/70">
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
