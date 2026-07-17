/**
 * Layout for authentication routes (sign-in, sign-up). Centered,
 * chrome-free layout distinct from both marketing and dashboard shells.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      {children}
    </div>
  );
}
