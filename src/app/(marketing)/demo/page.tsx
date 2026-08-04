import type { Metadata } from "next";
import { DemoReport } from "./DemoReport";

export const metadata: Metadata = {
  title: "Demo Report — Vault Brief",
  description:
    "See how Vault Brief turns Web3 project data into a report ready to send — toggle between a sample investor report and a sample grant report, both rendered through the same pipeline your own project would use.",
};

// The interactive mode toggle (investor vs. grant) lives in DemoReport, a
// client component — it needs useState for the tab switch. This page stays
// a server component purely so it can export `metadata`.
export default function DemoPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      <DemoReport />
    </div>
  );
}
