import Link from "next/link";

import { DomainError } from "@/domain/errors/domain-error";
import { makeVerifyEmailUseCase } from "@/application/use-cases/auth/compose";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let errorMessage: string | null = null;

  if (!token) {
    errorMessage = "This link is missing a verification token.";
  } else {
    try {
      await makeVerifyEmailUseCase().execute(token);
    } catch (error) {
      errorMessage =
        error instanceof DomainError
          ? error.message
          : "Something went wrong verifying your email.";
    }
  }

  return (
    <div className="flex flex-col gap-6 text-center">
      {errorMessage ? (
        <>
          <h1 className="text-2xl font-semibold">Verification failed</h1>
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Email verified</h1>
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            Your email has been confirmed. You can now log in.
          </p>
        </>
      )}
      <Link href="/auth/login">
        <Button className="w-full">Go to login</Button>
      </Link>
    </div>
  );
}
