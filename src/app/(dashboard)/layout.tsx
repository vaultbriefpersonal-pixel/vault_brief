import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { TrialBanner } from "@/components/layout/TrialBanner";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <DashboardShell sidebar={<Sidebar />}>
      {/* TrialBanner is a server component that null-renders for paid
          plans / users without trial info — costs nothing on those paths.
          Sits above the page content so every authed surface shows the
          same trial state. */}
      <TrialBanner />
      {children}
    </DashboardShell>
  );
}
