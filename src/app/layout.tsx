import type { Metadata } from "next";
import {
  Inter,
  Space_Grotesk,
  Geist_Mono,
  Spectral,
  IBM_Plex_Mono,
} from "next/font/google";
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

// The report document's faces, deliberately distinct from the three above.
// The app is a dashboard and reads like one; a report is read by investors
// and grant funders, printed, and attached to emails, so it gets the
// typographic register of a document instead.
//
// Loaded through next/font/google rather than as local files even though the
// PDF ships the same families as base64: Next self-hosts and subsets these
// automatically, and inlining them here would defeat browser caching. The two
// paths are allowed to differ because their constraints do — see
// src/server/services/pdf-fonts.ts for why the PDF cannot read from disk.
//
// Weights match what the PDF registers, so the two surfaces agree: 400/600
// upright plus a 400 italic for the serif, 400 for the mono.
const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
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
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} ${spectral.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
