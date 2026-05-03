import { Nav } from "@/components/marketing/Nav";
import { Footer } from "@/components/marketing/Footer";

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
    </>
  );
}
