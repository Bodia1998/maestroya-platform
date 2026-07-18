import Link from "next/link";

/**
 * Server Component — no interactivity needed at this level, just shared
 * chrome around whichever auth page is active.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-12">
      <Link href="/" className="text-xl font-bold">
        MaestroYa
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
