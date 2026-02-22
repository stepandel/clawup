"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const presets = [
  {
    name: "Juno",
    role: "Product Manager",
    emoji: "📋",
    colorClass: "text-accent-purple",
    bgClass: "bg-accent-purple-faded",
    borderClass: "hover:border-accent-purple-border",
    docsUrl: "https://docs.clawup.ai/architecture/agent-presets#juno-pm",
    description:
      "Breaks down tickets, researches APIs and requirements, sizes work into sub-issues, enriches context, and assigns tasks to the engineering agent.",
    tags: ["Linear", "Ticket Prep", "Planning"],
  },
  {
    name: "Titus",
    role: "Lead Engineer",
    emoji: "⚡",
    colorClass: "text-accent-blue",
    bgClass: "bg-accent-blue-faded",
    borderClass: "hover:border-accent-blue-border",
    docsUrl: "https://docs.clawup.ai/architecture/agent-presets#titus-eng",
    description:
      "Picks up assigned tickets, writes production code via Claude Code, runs builds and tests, creates pull requests, and responds to review feedback.",
    tags: ["Claude Code", "GitHub", "CI/CD"],
  },
  {
    name: "Scout",
    role: "QA Engineer",
    emoji: "🔍",
    colorClass: "text-accent-green",
    bgClass: "bg-accent-green-faded",
    borderClass: "hover:border-accent-green-border",
    docsUrl: "https://docs.clawup.ai/architecture/agent-presets#scout-qa",
    description:
      "Reviews pull requests against acceptance criteria, runs tests, auto-fixes failures with Claude Code, and labels PRs as approved or needs-work.",
    tags: ["Code Review", "Testing", "QA"],
  },
];

const steps = [
  {
    number: "01",
    title: "Define",
    description:
      "Declare your agent's identity, model, tools, and skills in a simple YAML file.",
    command: "vim atlas.yaml",
  },
  {
    number: "02",
    title: "Deploy",
    description:
      "One command provisions cloud infrastructure and launches your agents.",
    command: "clawup deploy",
  },
  {
    number: "03",
    title: "Manage",
    description:
      "Monitor, update, and scale your fleet from the terminal. Changes tracked in git.",
    command: "clawup status",
  },
];

const features = [
  {
    icon: "📁",
    title: "Git-Trackable Identity",
    description:
      "Agent definitions live in your repo. Review changes in PRs, roll back with git revert.",
  },
  {
    icon: "☁️",
    title: "Multi-Cloud",
    description:
      "Deploy to AWS or Hetzner today. Bring your own infrastructure tomorrow.",
  },
  {
    icon: "🔓",
    title: "Open Source",
    description:
      "MIT licensed. Fork it, extend it, contribute back. No vendor lock-in.",
  },
  {
    icon: "⌨️",
    title: "Single CLI",
    description:
      "One tool to init, deploy, update, and manage your entire agent fleet.",
  },
  {
    icon: "🦞",
    title: "OpenClaw Native",
    description:
      "Built on OpenClaw — the open runtime for autonomous AI agents.",
  },
  {
    icon: "🧩",
    title: "Extensible Skills",
    description:
      "Attach reusable skill packs to any agent. Share them across your fleet.",
  },
];

const identityFiles = [
  {
    file: "SOUL.md",
    description: "Personality, values, and behavioral guidelines",
  },
  {
    file: "IDENTITY.md",
    description: "Name, role, emoji, and display metadata",
  },
  {
    file: "HEARTBEAT.md",
    description: "Recurring checks and autonomous task loops",
  },
];

const yamlSnippet = `name: researcher
displayName: Atlas
role: researcher
emoji: telescope
model: anthropic/claude-sonnet-4-5
codingAgent: claude-code

deps:
  - brave-search

plugins:
  - slack

skills:
  - research-report`;

const customYamlSnippet = `name: ops-monitor
displayName: Sentinel
role: infrastructure-monitor
emoji: satellite
model: anthropic/claude-sonnet-4-5

deps:
  - brave-search

plugins:
  - slack
  - pagerduty

skills:
  - healthcheck
  - incident-response

templateVars:
  - OWNER_NAME
  - ESCALATION_CHANNEL`;

function renderYamlLine(line: string, i: number) {
  const colonIdx = line.indexOf(":");
  if (colonIdx > 0 && !line.trimStart().startsWith("-") && !line.trimStart().startsWith("#")) {
    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx);
    return (
      <div key={i}>
        <span className="text-accent-blue">{key}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
    );
  }
  return <div key={i}>{line || "\u00A0"}</div>;
}

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden">
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
            href="/blog/launch"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Blog
          </a>
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

      {/* Hero */}
      <section className="relative max-w-4xl mx-auto px-8 pt-44 pb-24 text-center">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[600px] h-[400px] bg-[radial-gradient(ellipse,_rgba(59,130,246,0.12)_0%,_transparent_70%)] pointer-events-none" />

        <div className="animate-fade-in-up">
          <Badge
            variant="outline"
            className="mb-7 px-4 py-1.5 text-xs font-medium text-primary border-primary/30 bg-primary/8"
          >
            Open source &middot; Infrastructure as Code
          </Badge>
        </div>

        <h1 className="animate-fade-in-up-1 text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[1.1] tracking-tighter mb-4 bg-gradient-to-b from-foreground to-foreground/50 bg-clip-text text-transparent">
          Define, deploy, and manage
          <br />
          AI agent fleets
        </h1>

        <p className="animate-fade-in-up-1 text-[clamp(1rem,2vw,1.35rem)] text-muted-foreground max-w-2xl mx-auto mb-3 leading-relaxed">
          All from your terminal.
        </p>

        <a
          href="https://openclaw.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="animate-fade-in-up-1 inline-flex items-center gap-1.5 text-base text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          Powered by{" "}
          <span className="font-semibold text-foreground/80">OpenClaw</span> 🦞
        </a>

        <p className="animate-fade-in-up-2 text-[clamp(0.9rem,1.8vw,1.1rem)] text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
          Declare agent identities in YAML. Deploy to AWS or Hetzner with one
          command. Track changes in git.
        </p>

        {/* Install command */}
        <div className="animate-fade-in-up-3 max-w-md mx-auto mb-10">
          <div className="flex items-center gap-3 px-6 py-4 rounded-xl bg-muted border border-border font-mono text-sm">
            <span className="text-accent-emerald">$</span>
            <code className="text-foreground flex-1 text-left">
              npm install -g clawup
            </code>
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
        </div>

        <div className="animate-fade-in-up-3 flex justify-center gap-4 flex-wrap">
          <Button
            asChild
            size="lg"
            className="shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
          >
            <a
              href="https://github.com/stepandel/clawup"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="https://docs.clawup.ai">Read the Docs</a>
          </Button>
        </div>
      </section>

      {/* Terminal Preview — YAML-first flow */}
      <section className="max-w-2xl mx-auto mb-24 px-8">
        <div className="animate-fade-in-up-3 bg-muted border border-border rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs text-muted-foreground">
              Terminal
            </span>
          </div>
          {/* Content */}
          <div className="p-6 font-mono text-sm leading-7">
            <div className="mb-1">
              <span className="text-accent-emerald">$</span>{" "}
              <span className="text-foreground">cat atlas.yaml</span>
            </div>
            <div className="text-muted-foreground pl-2 mb-3 whitespace-pre leading-6 text-xs">
              {yamlSnippet.split("\n").map(renderYamlLine)}
            </div>
            <div className="mb-1">
              <span className="text-accent-emerald">$</span>{" "}
              <span className="text-foreground">clawup deploy</span>
            </div>
            <div className="text-muted-foreground">
              Deploying 1 agent to Hetzner (nbg1)...
            </div>
            <div>
              <span className="text-accent-emerald">✓</span>{" "}
              <span className="text-muted-foreground">
                Atlas (researcher) —{" "}
              </span>
              <span className="text-accent-emerald">ready</span>
            </div>
            <div className="mt-1">
              <span className="text-accent-emerald">$</span>{" "}
              <span className="text-muted-foreground">
                <span className="animate-pulse-glow">▊</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-3xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            How it works
          </h2>
          <p className="text-base text-muted-foreground max-w-md mx-auto">
            From YAML definition to running agent in minutes.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group flex items-center gap-7 px-8 py-7 rounded-xl border border-border bg-card/30 transition-all duration-200 hover:bg-card/60 hover:border-primary/30"
            >
              <span className="text-3xl font-extrabold text-border/80 tabular-nums shrink-0 w-13 transition-colors duration-200 group-hover:text-primary">
                {step.number}
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-foreground mb-1">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
              <code className="text-xs font-mono text-accent-emerald bg-accent-emerald/6 border border-accent-emerald/12 px-4 py-2 rounded-lg whitespace-nowrap shrink-0">
                {step.command}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Starter Templates */}
      <section className="max-w-5xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Battle-tested starter templates
          </h2>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            Get started in seconds with preset agent identities — or define your
            own from scratch.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {presets.map((agent) => (
            <a
              key={agent.name}
              href={agent.docsUrl}
              className={`group block rounded-2xl border border-border bg-card/30 p-7 transition-all duration-250 hover:bg-card/60 ${agent.borderClass}`}
            >
              <div className="flex items-center gap-3.5 mb-4">
                <div
                  className={`w-12 h-12 rounded-xl ${agent.bgClass} flex items-center justify-center text-[22px] transition-transform duration-250 group-hover:scale-110`}
                >
                  {agent.emoji}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {agent.name}
                  </h3>
                  <span className={`text-xs font-medium ${agent.colorClass}`}>
                    {agent.role}
                  </span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                {agent.description}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {agent.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-[11px] font-medium text-muted-foreground bg-card/50 border-border"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Build Your Own */}
      <section className="max-w-4xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Build your own agent
          </h2>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            Define any agent in YAML. Give it a soul, an identity, and a
            heartbeat. Deploy it anywhere.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* YAML snippet */}
          <div className="bg-muted border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-xs text-muted-foreground">
                sentinel.yaml
              </span>
            </div>
            <div className="p-6 font-mono text-xs leading-6 whitespace-pre text-muted-foreground">
              {customYamlSnippet.split("\n").map(renderYamlLine)}
            </div>
          </div>

          {/* Identity files */}
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground mb-2">
              Each agent gets its own identity files — version-controlled
              markdown that defines who the agent is and how it behaves:
            </p>
            {identityFiles.map((item) => (
              <div
                key={item.file}
                className="flex items-start gap-4 px-6 py-5 rounded-xl border border-border bg-card/30"
              >
                <code className="text-sm font-mono text-accent-emerald bg-accent-emerald/6 border border-accent-emerald/12 px-3 py-1 rounded-lg whitespace-nowrap shrink-0">
                  {item.file}
                </code>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Clawup */}
      <section className="max-w-5xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Why Clawup
          </h2>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            You&apos;ve built your agents. Now ship them.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-border bg-card/30 p-7 transition-all duration-200 hover:bg-card/60 hover:border-primary/30"
            >
              <div className="text-2xl mb-4">{feature.icon}</div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

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
