"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const agents = [
  {
    name: "Juno",
    role: "Product Manager",
    emoji: "📋",
    colorClass: "text-accent-purple",
    bgClass: "bg-accent-purple-faded",
    borderClass: "hover:border-accent-purple-border",
    docsUrl: "https://docs.agent-army.ai/architecture/agent-presets#juno-pm",
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
    docsUrl: "https://docs.agent-army.ai/architecture/agent-presets#titus-eng",
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
    docsUrl: "https://docs.agent-army.ai/architecture/agent-presets#scout-qa",
    description:
      "Reviews pull requests against acceptance criteria, runs tests, auto-fixes failures with Claude Code, and labels PRs as approved or needs-work.",
    tags: ["Code Review", "Testing", "QA"],
  },
];

const steps = [
  {
    number: "01",
    title: "Install",
    command: "npm install -g agent-army",
    description: "One command to get the CLI on your machine.",
  },
  {
    number: "02",
    title: "Configure",
    command: "agent-army init",
    description: "Interactive wizard sets up your cloud, integrations, and team.",
  },
  {
    number: "03",
    title: "Deploy",
    command: "agent-army deploy",
    description: "Provisions your fleet in minutes. Agents start working immediately.",
  },
];

const features = [
  {
    icon: "🏗️",
    title: "Infrastructure as Code",
    description:
      "Pulumi-powered deployments on AWS EC2 or Hetzner Cloud. Reproducible, version-controlled, and tear-downable.",
  },
  {
    icon: "🔒",
    title: "Zero-Trust Access",
    description:
      "Every agent is accessible only through Tailscale. No public ports, no exposed APIs. SSH optional.",
  },
  {
    icon: "🔄",
    title: "Autonomous Heartbeat",
    description:
      "Agents run a 1-minute heartbeat loop — checking for new work, updating status, and coordinating with each other.",
  },
  {
    icon: "🔌",
    title: "Deep Integrations",
    description:
      "Native Linear, Slack, and GitHub integration. Agents read tickets, post updates, create PRs, and respond to messages.",
  },
  {
    icon: "🎭",
    title: "Role-Based Presets",
    description:
      "Each agent ships with a tuned personality, tools, and workflow. Customize or create your own roles from scratch.",
  },
  {
    icon: "💰",
    title: "Cost Effective",
    description:
      "Shared VPC, small instance types, and spot-instance ready. Run a full 3-agent team for under $30/month on Hetzner.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden">
      {/* Beta Banner */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-center px-4 py-2 text-sm font-semibold">
        ⚠️ This is a beta product — use at your own risk.
      </div>

      {/* Nav */}
      <nav className="fixed top-10 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 backdrop-blur-md bg-background/80 border-b border-border">
        <a href="/" className="flex items-center gap-2.5">
          <span className="text-xl">🪖</span>
          <span className="text-base font-bold tracking-tight">Agent Army</span>
        </a>
        <div className="flex items-center gap-6">
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

      {/* Hero */}
      <section className="relative max-w-4xl mx-auto px-8 pt-44 pb-24 text-center">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[600px] h-[400px] bg-[radial-gradient(ellipse,_rgba(59,130,246,0.12)_0%,_transparent_70%)] pointer-events-none" />

        <div className="animate-fade-in-up">
          <Badge
            variant="outline"
            className="mb-7 px-4 py-1.5 text-xs font-medium text-primary border-primary/30 bg-primary/8"
          >
            Open source &middot; Deploy in minutes
          </Badge>
        </div>

        <h1 className="animate-fade-in-up-1 text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-[1.1] tracking-tighter mb-4 bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent">
          Your AI dev team,
          <br />
          deployed in minutes
        </h1>

        <a
          href="https://openclaw.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="animate-fade-in-up-1 inline-flex items-center gap-1.5 text-base text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          Powered by <span className="font-semibold text-foreground/80">OpenClaw</span> 🦞
        </a>

        <p className="animate-fade-in-up-2 text-[clamp(1rem,2vw,1.25rem)] text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
          A PM, an engineer, and a QA tester — each running on their own cloud
          instance, coordinating through Linear, Slack, and GitHub.
        </p>

        {/* Install command */}
        <div className="animate-fade-in-up-3 max-w-md mx-auto mb-10">
          <div className="flex items-center gap-3 px-6 py-4 rounded-xl bg-[#0c0c0c] border border-border font-mono text-sm">
            <span className="text-accent-emerald">$</span>
            <code className="text-foreground flex-1 text-left">npm install -g agent-army</code>
            <button
              onClick={() => navigator.clipboard.writeText("npm install -g agent-army")}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Copy to clipboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            </button>
          </div>
        </div>

        <div className="animate-fade-in-up-3 flex justify-center gap-4 flex-wrap">
          <Button asChild size="lg" className="shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]">
            <a
              href="https://github.com/stepandel/agent-army"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a href="https://docs.agent-army.ai">Read the Docs</a>
          </Button>
        </div>
      </section>

      {/* Terminal Preview */}
      <section className="max-w-2xl mx-auto mb-24 px-8">
        <div className="animate-fade-in-up-3 bg-[#0c0c0c] border border-border rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs text-muted-foreground">Terminal</span>
          </div>
          {/* Content */}
          <div className="p-6 font-mono text-sm leading-8">
            <div>
              <span className="text-accent-emerald">$</span>{" "}
              <span className="text-foreground">agent-army deploy</span>
            </div>
            <div className="text-muted-foreground">
              Deploying 3 agents to Hetzner (nbg1)...
            </div>
            <div>
              <span className="text-accent-purple">&#x2713;</span>{" "}
              <span className="text-muted-foreground">Juno (PM) — </span>
              <span className="text-accent-purple">ready</span>
            </div>
            <div>
              <span className="text-accent-blue">&#x2713;</span>{" "}
              <span className="text-muted-foreground">Titus (Eng) — </span>
              <span className="text-accent-blue">ready</span>
            </div>
            <div>
              <span className="text-accent-green">&#x2713;</span>{" "}
              <span className="text-muted-foreground">Scout (QA) — </span>
              <span className="text-accent-green">ready</span>
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

      {/* Meet the Team */}
      <section className="max-w-5xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Three agents. One workflow.
          </h2>
          <p className="text-base text-muted-foreground max-w-lg mx-auto">
            Each agent has a specialized role, its own cloud instance, and a
            heartbeat loop that runs every 60 seconds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {agents.map((agent) => (
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

      {/* How It Works */}
      <section className="max-w-3xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Up and running in 3 steps
          </h2>
          <p className="text-base text-muted-foreground max-w-md mx-auto">
            From zero to a fully autonomous dev team in under 10 minutes.
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

      {/* Features Grid */}
      <section className="max-w-5xl mx-auto px-8 py-20">
        <div className="text-center mb-14">
          <h2 className="text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight mb-4">
            Built for real workflows
          </h2>
          <p className="text-base text-muted-foreground max-w-md mx-auto">
            Not a toy. Production-grade infrastructure for autonomous AI agents.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-7 rounded-xl border border-border bg-card/30"
            >
              <div className="text-3xl mb-3.5">{feature.icon}</div>
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

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-8 pt-20 pb-28 text-center">
        <div className="p-16 rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/6 to-accent-purple/4">
          <h2 className="text-[clamp(1.5rem,3vw,2.2rem)] font-bold tracking-tight mb-4">
            Ready to deploy your team?
          </h2>
          <p className="text-base text-muted-foreground max-w-md mx-auto mb-8">
            Get a PM, engineer, and QA tester running on your cloud in under 10
            minutes. Open source, always.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <Button asChild size="lg" className="shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]">
              <a
                href="https://github.com/stepandel/agent-army"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="https://docs.agent-army.ai">Read the Docs</a>
            </Button>
          </div>
        </div>
      </section>

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
                {
                  label: "GitHub",
                  href: "https://github.com/stepandel/agent-army",
                },
                { label: "Documentation", href: "https://docs.agent-army.ai" },
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
