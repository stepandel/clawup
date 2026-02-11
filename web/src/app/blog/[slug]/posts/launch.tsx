export default function LaunchPost() {
  return (
    <div className="space-y-6 text-[15px] leading-relaxed text-muted-foreground">
      <p>
        Last week the weather in the Bay Area was fantastic and I really wanted to take
        a road trip and take my eyes off the monitor. But with all the OpenClaw craze
        going on, it was getting really hard to step away.
      </p>
      <p>
        Inspired by{" "}
        <a
          href="https://x.com/steipete"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          @steipete
        </a>{" "}
        to take my work on the road and delegate my ideas to OpenClaw, I went on the
        trip and came back to several open PRs. Over the next 7 days, the team
        cumulatively closed over 150 tickets across 4 projects. Here&apos;s my setup
        and what I learned.
      </p>

      {/* Stage 0 */}
      <h2 className="text-xl font-bold text-foreground pt-4">
        Stage 0: Just asking OpenClaw to do work
      </h2>
      <p>
        At first I just messaged my OpenClaw agent and asked it to tackle Linear tickets
        directly. It worked okay. But I quickly realized my workflow naturally splits
        into 3 stages:
      </p>
      <ol className="list-decimal list-inside space-y-2 pl-1">
        <li>
          <span className="font-semibold text-foreground">Research</span> — I prompt
          the agent to do deep research on the ticket topic, look over all the code in
          the repo, and propose an adequate solution
        </li>
        <li>
          <span className="font-semibold text-foreground">Plan</span> — I ask it to
          summarize everything and drop the plan back into the Linear ticket as a
          comment (kind of like Plan mode in Claude Code)
        </li>
        <li>
          <span className="font-semibold text-foreground">Execute</span> — I ask it to
          implement the proposed solution by breaking it down into digestible smaller
          sub-tickets, then code each one
        </li>
      </ol>
      <p>
        The results were almost good. But &ldquo;almost&rdquo; adds up. Sometimes the
        tests don&apos;t pass. Sometimes the build compiles with errors. Sometimes there
        are review comments from review agents like CodeRabbit that need to be addressed.
        So I&apos;d send it back to the PR and ask it to fix things up.
      </p>
      <p>
        A few things I learned the hard way:
      </p>
      <ul className="list-disc list-inside space-y-2 pl-1">
        <li>
          Agents stumble when instructions are too concrete and rigid — they need room
          to reason about the problem, not just follow a script
        </li>
        <li>
          Scout (QA) would consistently ignore PR review comments unless explicitly
          reminded to check for them in its heartbeat
        </li>
        <li>
          Context windows fill up fast when one agent is doing research, planning, and
          coding — quality degrades noticeably toward the end of long tasks
        </li>
      </ul>
      <p>
        A single agent doing all three stages works, but it&apos;s slow and the context
        gets messy. The agent that researched the problem is now also trying to debug a
        failing CI pipeline. Not great.
      </p>

      {/* The insight */}
      <h2 className="text-xl font-bold text-foreground pt-4">
        The insight: 3 agents &gt; 1 agent
      </h2>
      <p>
        I found that having three separate agents — each with a clear role — is actually
        better and faster than asking a single agent to do everything.
      </p>
      <p>So I split responsibilities, just like in a human team:</p>

      {/* Agents table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card/40">
              <th className="text-left px-5 py-3 font-semibold text-foreground">Agent</th>
              <th className="text-left px-5 py-3 font-semibold text-foreground">Role</th>
              <th className="text-left px-5 py-3 font-semibold text-foreground">What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-5 py-3 font-semibold text-accent-purple">Juno</td>
              <td className="px-5 py-3">Product Manager</td>
              <td className="px-5 py-3">
                Picks up Linear tickets, researches requirements, reads the codebase,
                breaks work into sub-issues, writes acceptance criteria, and assigns
                tasks
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="px-5 py-3 font-semibold text-accent-blue">Titus</td>
              <td className="px-5 py-3">Lead Engineer</td>
              <td className="px-5 py-3">
                Takes assigned tickets, writes production code via Claude Code, runs
                builds and tests, opens PRs on GitHub, responds to review feedback
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3 font-semibold text-accent-green">Scout</td>
              <td className="px-5 py-3">QA Engineer</td>
              <td className="px-5 py-3">
                Reviews PRs against acceptance criteria, runs tests, auto-fixes test
                failures with Claude Code, flags issues back to Linear
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Each agent has its own personality defined in a{" "}
        <code className="text-xs font-mono text-accent-emerald bg-accent-emerald/6 border border-accent-emerald/12 px-1.5 py-0.5 rounded">
          SOUL.md
        </code>{" "}
        file, its own tools configuration, and its own persistent memory. They
        coordinate through Linear (ticket status), GitHub (PRs and reviews), and Slack
        (notifications).
      </p>

      {/* Heartbeats */}
      <h2 className="text-xl font-bold text-foreground pt-4">
        How they stay busy: Heartbeats
      </h2>
      <p>
        Each agent runs a heartbeat — a loop that fires every 60 seconds and checks for
        new work. This is the key difference from just prompting an agent once and
        walking away.
      </p>
      <p>
        Juno&apos;s heartbeat checks Linear for new tickets that need breakdown. Titus
        watches for tickets assigned to it in &ldquo;Ready&rdquo; status. Scout monitors
        open PRs that need review.
      </p>
      <p>
        No polling from my side. No babysitting. I assign a ticket to the PM, and the
        pipeline kicks off automatically. Juno researches and plans. Titus picks it up
        and codes. Scout reviews the PR. If Scout finds issues, it either fixes them
        directly or files a bug back to Linear — and the cycle continues.
      </p>
      <p>
        All context that&apos;s generally lost when agents switch tasks is persisted to
        Linear. Agents always know what&apos;s going on and I get visibility.
      </p>

      {/* Workflow in practice */}
      <h2 className="text-xl font-bold text-foreground pt-4">
        The workflow in practice
      </h2>
      <p>
        Here&apos;s what a typical ticket looks like flowing through the system:
      </p>
      <ol className="list-decimal list-inside space-y-2 pl-1">
        <li>I create a ticket in Linear (or just message Juno on Slack)</li>
        <li>
          <span className="font-semibold text-accent-purple">Juno</span> picks it up
          on the next heartbeat, reads the codebase, researches the problem, writes a
          technical plan with sub-tasks, and assigns it to Titus
        </li>
        <li>
          <span className="font-semibold text-accent-blue">Titus</span> picks up the
          sub-tasks, writes code using Claude Code, runs the build, and opens a PR
        </li>
        <li>
          <span className="font-semibold text-accent-green">Scout</span> picks up the
          PR, checks it against the acceptance criteria Juno wrote, runs tests, and
          either approves it or flags what needs fixing
        </li>
        <li>
          If something fails, Titus gets a new ticket or Scout addresses it directly
        </li>
      </ol>
      <p>All while I&apos;m driving through Big Sur with no cell service.</p>

      {/* Agent Army */}
      <h2 className="text-xl font-bold text-foreground pt-4">
        Deploying the team: Agent Army
      </h2>
      <p>
        As powerful as they are, changing the agents was a pain. I wanted to update
        skills, tweak heartbeats, and experiment with their context windows.
      </p>
      <p>
        At first I did everything manually—SSHing into servers, editing config files,
        restarting OpenClaw instances. It got old fast.
      </p>
      <p>
        So I built{" "}
        <a
          href="https://github.com/stepandel/agent-army"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Agent Army
        </a>
        , a CLI tool that handles the whole thing.
      </p>

      <div className="rounded-xl bg-[#0c0c0c] border border-border p-5 font-mono text-sm leading-7 overflow-x-auto">
        <div>
          <span className="text-accent-emerald">$</span>{" "}
          <span className="text-foreground">npm install -g agent-army</span>
        </div>
        <div>
          <span className="text-accent-emerald">$</span>{" "}
          <span className="text-foreground">agent-army init</span>
          <span className="text-muted-foreground/60">
            {"    "}# interactive wizard — cloud, keys, integrations
          </span>
        </div>
        <div>
          <span className="text-accent-emerald">$</span>{" "}
          <span className="text-foreground">agent-army deploy</span>
          <span className="text-muted-foreground/60">
            {"  "}# provisions 3 servers, installs everything
          </span>
        </div>
      </div>

      <p>
        That&apos;s it. Three agents, each on their own cloud instance (AWS or Hetzner),
        connected via a Tailscale mesh VPN, pre-configured with OpenClaw, Claude Code,
        Linear, GitHub, and Slack integrations. (The first setup is the longest, you need
        to set up all the keys but after that it&apos;s a one command to deploy or
        destroy)
      </p>
      <p>Each agent is defined by a set of workspace files:</p>

      <div className="rounded-xl bg-[#0c0c0c] border border-border p-5 font-mono text-sm leading-7 overflow-x-auto">
        <div className="text-muted-foreground">presets/</div>
        <div>
          <span className="text-muted-foreground">├── </span>
          <span className="text-accent-blue">base/</span>
          <span className="text-muted-foreground/60">
            {"           "}# Shared config (AGENTS.md, BOOTSTRAP.md, USER.md)
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">├── </span>
          <span className="text-accent-purple">pm/</span>
          <span className="text-muted-foreground/60">
            {"             "}# Juno: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">├── </span>
          <span className="text-accent-blue">eng/</span>
          <span className="text-muted-foreground/60">
            {"            "}# Titus: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">├── </span>
          <span className="text-accent-green">tester/</span>
          <span className="text-muted-foreground/60">
            {"         "}# Scout: SOUL.md, IDENTITY.md, HEARTBEAT.md, TOOLS.md
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">└── </span>
          <span className="text-accent-emerald">skills/</span>
          <span className="text-muted-foreground/60">
            {"         "}# Reusable skills (ticket prep, PR testing, etc.)
          </span>
        </div>
      </div>

      <p>
        You can use the built-in presets, tweak them, or define completely custom agents.
      </p>

      {/* Clean slate */}
      <h2 className="text-xl font-bold text-foreground pt-4">Clean slate resets</h2>
      <p>
        One thing I&apos;m currently experimenting with: completely resetting the context
        and redeploying the agents with a clean slate between major tasks.
      </p>
      <p>
        OpenClaw agents accumulate context over time, and sometimes that context gets
        stale or contradictory. A fresh deploy gives you agents that start from the
        latest version of your presets with zero baggage.
      </p>

      <div className="rounded-xl bg-[#0c0c0c] border border-border p-5 font-mono text-sm leading-7 overflow-x-auto">
        <div>
          <span className="text-accent-emerald">$</span>{" "}
          <span className="text-foreground">
            agent-army destroy -y && agent-army deploy -y
          </span>
        </div>
      </div>

      <p>
        Takes about 5 minutes. I do this roughly once a day or whenever I&apos;m
        shifting to a different codebase / project.
      </p>

      {/* Cost */}
      <h2 className="text-xl font-bold text-foreground pt-4">What it costs</h2>
      <p>
        On Hetzner, three CX22 instances (2 vCPU, 4GB RAM each) run about{" "}
        <span className="font-semibold text-foreground">$18–22/month</span>. On AWS
        with t3.medium instances, it&apos;s closer to{" "}
        <span className="font-semibold text-foreground">$110–120/month</span>. Plus
        your Anthropic API usage — I have the Max plan and I&apos;m running very close
        to the limit.
      </p>
      <p>
        I use Hetzner for development. It&apos;s ~80% cheaper and more than enough for
        this workload.
      </p>

      {/* Try it */}
      <h2 className="text-xl font-bold text-foreground pt-4">Try it</h2>
      <p>
        Agent Army is MIT licensed. The repo is at{" "}
        <a
          href="https://github.com/stepandel/agent-army"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          github.com/stepandel/agent-army
        </a>{" "}
        and the docs are at{" "}
        <a
          href="https://docs.agent-army.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          docs.agent-army.ai
        </a>
        .
      </p>
      <p>
        Install it, deploy my presets, or build your own team of agents. The presets are
        a starting point — the real power is in customizing the SOUL.md, HEARTBEAT.md,
        skills and plugins for your specific workflow.
      </p>
      <p>
        If you&apos;re spending time waiting for your Claude Code to finish work, go
        drive through Big Sur instead — Juno, Titus, and Scout will hold down the fort.
      </p>
    </div>
  );
}
