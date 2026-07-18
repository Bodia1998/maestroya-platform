import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-sm text-foreground/70">Choose a new password below.</p>
      </div>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          This link is missing a reset token. Request a new one from the forgot password page.
        </p>
      )}
    </div>
  );
}
