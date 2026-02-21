"use client";

import { useState, useEffect } from "react";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  const [showBanner, setShowBanner] = useState(true);

  useEffect(() => {
    const handleScroll = () => setShowBanner(window.scrollY < 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Beta Banner */}
      <div className={`fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-center px-4 py-2 text-sm font-semibold transition-transform duration-300 ${showBanner ? "translate-y-0" : "-translate-y-full"}`}>
        ⚠️ This is a beta product — use at your own risk.
      </div>

      {/* Nav */}
      <nav className={`fixed left-0 right-0 z-50 flex items-center justify-between px-8 py-4 backdrop-blur-md bg-background/80 border-b border-border transition-[top] duration-300 ${showBanner ? "top-10" : "top-0"}`}>
        <a href="/" className="flex items-center gap-2.5">
          <span className="text-xl">🪖</span>
          <span className="text-base font-bold tracking-tight">Agent Army</span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/blog/launch"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Blog
          </a>
          <a
            href="https://docs.agent-army.ai"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </a>
          <a
            href="https://github.com/stepandel/agent-army"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-36 pb-24">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-10">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div className="flex justify-between items-center flex-wrap gap-5">
            <div className="flex items-center gap-2.5">
              <span className="text-base">🪖</span>
              <span className="text-sm font-semibold text-muted-foreground">
                Agent Army
              </span>
            </div>
            <div className="flex gap-7 flex-wrap">
              {[
                { label: "Blog", href: "/blog/launch" },
                { label: "GitHub", href: "https://github.com/stepandel/agent-army" },
                { label: "Documentation", href: "https://docs.agent-army.ai" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <div className="text-center">
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              Powered by OpenClaw 🦞
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
