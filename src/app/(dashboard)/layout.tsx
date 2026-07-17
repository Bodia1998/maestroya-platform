import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Layout for authenticated routes. Guards every route nested under
 * (dashboard) with a single auth check here rather than repeating it in
 * every page — this is the layout's whole job.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/sign-in");
  }

  return <div className="flex min-h-screen">{children}</div>;
}
