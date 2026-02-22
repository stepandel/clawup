"use client";

import { Button } from "@/components/ui/button";
import { CUSTOM_YAML_SNIPPET, CONFIG_YAML_SNIPPET, WORKSPACE_FILES } from "./data/constants";
import { renderYamlLine } from "./components/render-yaml-line";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 backdrop-blur-md bg-background/80 border-b border-border"
      >
        <a href="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Clawup" className="h-7 w-7" />
          <span className="text-base font-bold tracking-tight">
            Clawup
          </span>
        </a>
        <div className="flex items-center gap-6">
          <a
            href="https://docs.clawup.ai"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Docs
          </a>
          <a
            href="https://github.com/stepandel/clawup"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Bento Grid */}
      <div className="max-w-7xl mx-auto px-8 pt-32 pb-12 grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
        {/* Hero */}
        <section className="lg:col-span-3 bg-card border border-border rounded-lg p-6">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3">
            Clawup
          </h1>
          <p className="text-lg text-muted-foreground mb-6 max-w-xl">
            Deploy fleets of specialized AI agents to your cloud. Define identities in YAML, provision with one command, track changes in git.
          </p>

          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-background border border-border font-mono text-sm w-fit mb-6">
            <span className="text-accent-emerald">$</span>
            <code className="text-foreground">npm install -g clawup</code>
            <button
              onClick={() =>
                navigator.clipboard?.writeText("npm install -g clawup").catch(() => {})
              }
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Copy to clipboard"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <Button asChild size="lg">
              <a href="https://docs.clawup.ai">Read the Docs</a>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Powered by{" "}
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/80 font-medium hover:text-foreground transition-colors"
            >
              OpenClaw
            </a>
            {" "}&middot; Infrastructure via{" "}
            <a
              href="https://www.pulumi.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/80 font-medium hover:text-foreground transition-colors"
            >
              Pulumi
            </a>
            {" "}&middot; Secure networking via{" "}
            <a
              href="https://tailscale.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/80 font-medium hover:text-foreground transition-colors"
            >
              Tailscale
            </a>
          </p>
        </section>

        {/* Quick Start */}
        <section className="lg:col-span-2 lg:pt-16">
          <h2 className="text-xl font-bold tracking-tight mb-4">Quick start</h2>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center px-4 py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">Terminal</span>
            </div>
            <div className="p-4 font-mono text-xs leading-7">
              <div>
                <span className="text-accent-emerald">$</span>{" "}
                <span className="text-foreground">npm install -g clawup</span>
              </div>
              <div>
                <span className="text-accent-emerald">$</span>{" "}
                <span className="text-foreground">clawup init</span>
                {"      "}
                <span className="text-muted-foreground/50"># interactive setup wizard</span>
              </div>
              <div>
                <span className="text-accent-emerald">$</span>{" "}
                <span className="text-foreground">clawup deploy</span>
                {"    "}
                <span className="text-muted-foreground/50"># provisions agents to your cloud</span>
              </div>
            </div>
          </div>
        </section>

        {/* Built-in Agents */}
        <section className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-bold tracking-tight mb-4">Built-in agents</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-semibold text-foreground">Agent</th>
                  <th className="py-2 pr-4 font-semibold text-foreground">Role</th>
                  <th className="py-2 font-semibold text-foreground">Heartbeat</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border">
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="text-accent-purple font-medium">📋 Juno</span>
                  </td>
                  <td className="py-3 pr-4">PM</td>
                  <td className="py-3">Queue-driven: preps tickets</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="text-accent-blue font-medium">⚙️ Titus</span>
                  </td>
                  <td className="py-3 pr-4">Engineer</td>
                  <td className="py-3">Queue-driven: implements tickets</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="text-accent-green font-medium">🔍 Scout</span>
                  </td>
                  <td className="py-3 pr-4">QA</td>
                  <td className="py-3">Polling: reviews PRs</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Config Example */}
        <section className="lg:col-span-3 bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-bold tracking-tight mb-4">Config example</h2>
          <p className="text-sm text-muted-foreground mb-4">
            <code className="text-foreground/80">clawup init</code> generates a manifest that defines your stack and agents.
          </p>
          <div className="bg-background border border-border rounded-lg overflow-hidden">
            <div className="flex items-center px-4 py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">clawup.yaml</span>
            </div>
            <div className="p-4 font-mono text-xs leading-6 whitespace-pre text-muted-foreground">
              {CONFIG_YAML_SNIPPET.split("\n").map(renderYamlLine)}
            </div>
          </div>
        </section>

        {/* Build Your Own Agent */}
        <section className="lg:col-span-5 bg-card border border-border rounded-lg p-6">
          <h2 className="text-xl font-bold tracking-tight mb-4">Build your own agent</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* YAML snippet */}
            <div className="bg-background border border-border rounded-lg overflow-hidden">
              <div className="flex items-center px-4 py-2.5 border-b border-border">
                <span className="text-xs text-muted-foreground">identity.yaml</span>
              </div>
              <div className="p-4 font-mono text-xs leading-6 whitespace-pre text-muted-foreground">
                {CUSTOM_YAML_SNIPPET.split("\n").map(renderYamlLine)}
              </div>
            </div>

            {/* Workspace files */}
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Each agent gets workspace files — version-controlled markdown that defines who the agent is and how it behaves:
              </p>
              <div className="flex flex-col">
                {WORKSPACE_FILES.map((item, i) => (
                  <div
                    key={item.file}
                    className={`flex items-baseline gap-3 py-3 ${i < WORKSPACE_FILES.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <code className="text-xs font-mono text-accent-emerald whitespace-nowrap shrink-0">
                      {item.file}
                    </code>
                    <span className="text-sm text-muted-foreground">
                      — {item.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-10">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div className="flex justify-between items-center flex-wrap gap-5">
            <div className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="Clawup" className="h-5 w-5" />
              <span className="text-sm font-semibold text-muted-foreground">
                Clawup
              </span>
            </div>
            <div className="flex gap-7 flex-wrap">
              {[
                {
                  label: "GitHub",
                  href: "https://github.com/stepandel/clawup",
                },
                {
                  label: "Documentation",
                  href: "https://docs.clawup.ai",
                },
                { label: "OpenClaw", href: "https://openclaw.ai" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
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
