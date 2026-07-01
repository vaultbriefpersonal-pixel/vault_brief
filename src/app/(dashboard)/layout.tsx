import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Public-goods pivot: no trial banner — VaultBrief is free.
  return (
    <DashboardShell sidebar={<Sidebar />}>
      {children}
    </DashboardShell>
  );
}
