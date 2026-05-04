import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";
import { ChatWidget } from "@/components/marketing/ChatWidget";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav />
      <main style={{ background: "var(--vb-bg)", minHeight: "100dvh" }}>
        {children}
      </main>
      <Footer />
      {/* Visitor-facing AI chat. Mounted only in the marketing layout —
          dashboard users have other support channels. */}
      <ChatWidget />
    </>
  );
}
