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
      <main style={{ background: "#0a0a0a", minHeight: "100vh" }}>
        {children}
      </main>
      <Footer />
    </>
  );
}
