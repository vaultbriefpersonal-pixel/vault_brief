import type { Metadata } from "next";
import { Inter, Space_Grotesk, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Canonical origin for resolving relative OG / Twitter image URLs.
  // Without this, Next.js falls back to http://localhost:3000 at build
  // time, so social-share previews on vaultbrief.io would point image
  // tags at localhost and break the unfurl. Matches the apex host used
  // in sitemap.ts / robots. Keep in sync if the canonical host changes.
  metadataBase: new URL("https://vaultbrief.io"),
  title: "Vault Brief — Automated Investor Reporting for Web3",
  description:
    "Turn your on-chain treasury into investor-ready reports. Automatically. Connect wallets, generate AI reports, send to investors every month.",
  openGraph: {
    title: "Vault Brief — Automated Investor Reporting for Web3",
    description:
      "Turn your on-chain treasury into investor-ready reports. Automatically.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vault Brief — Automated Investor Reporting for Web3",
    description:
      "Turn your on-chain treasury into investor-ready reports. Automatically.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
