import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://agent-army.ai"),
  title: {
    default: "Agent Army | Your AI Dev Team",
    template: "%s | Agent Army",
  },
  description:
    "Deploy and manage autonomous AI coding agents on your own cloud infrastructure. Agent Army provisions, orchestrates, and monitors AI dev teams with a single CLI command.",
  keywords: [
    "AI agents",
    "autonomous coding",
    "AI dev team",
    "cloud infrastructure",
    "CLI",
    "developer tools",
    "AI orchestration",
  ],
  openGraph: {
    title: "Agent Army | Your AI Dev Team",
    description:
      "Deploy and manage autonomous AI coding agents on your own cloud infrastructure.",
    type: "website",
    url: "https://agent-army.ai",
    siteName: "Agent Army",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Agent Army — Deploy AI coding agents on your cloud",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Army | Your AI Dev Team",
    description:
      "Deploy and manage autonomous AI coding agents on your own cloud infrastructure.",
    images: ["/og-image.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agent Army",
  description:
    "Deploy and manage autonomous AI coding agents on your own cloud infrastructure. Provision, orchestrate, and monitor AI dev teams with a single CLI command.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, macOS",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  url: "https://agent-army.ai",
  author: {
    "@type": "Organization",
    name: "Agent Army",
    url: "https://agent-army.ai",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={GeistSans.className}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
