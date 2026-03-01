import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://clawup.sh"),
  title: {
    default: "Clawup — The Secure Golden Path for OpenClaw Agent Swarms",
    template: "%s | Clawup",
  },
  description:
    "The secure golden path for deploying OpenClaw agent swarms. Identity-driven, infrastructure-as-code, zero public ports. Built on Pulumi and Tailscale.",
  keywords: [
    "clawup",
    "openclaw",
    "AI agents",
    "AI agent deployment",
    "autonomous coding agents",
    "AI dev team",
    "cloud infrastructure",
    "agent orchestration",
    "Pulumi",
    "Tailscale",
    "CLI",
    "developer tools",
  ],
  openGraph: {
    title: "Clawup — The Secure Golden Path for OpenClaw Agent Swarms",
    description:
      "The secure golden path for deploying OpenClaw agent swarms. Identity-driven, infrastructure-as-code, zero public ports.",
    type: "website",
    url: "https://clawup.sh",
    siteName: "Clawup",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Clawup — The secure golden path for OpenClaw agent swarms",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clawup — The Secure Golden Path for OpenClaw Agent Swarms",
    description:
      "The secure golden path for deploying OpenClaw agent swarms. Identity-driven, infrastructure-as-code, zero public ports.",
    images: ["/og-image.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Clawup",
  description:
    "The secure golden path for deploying OpenClaw agent swarms. Identity-driven, infrastructure-as-code, zero public ports. Built on Pulumi and Tailscale.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, macOS",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  url: "https://clawup.sh",
  author: {
    "@type": "Organization",
    name: "Clawup",
    url: "https://clawup.sh",
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
