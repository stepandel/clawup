"use client";

import { useState } from "react";
import {
  PROVIDERS,
  AWS_REGIONS,
  HETZNER_LOCATIONS,
  INSTANCE_TYPES,
  hetznerServerTypes,
  COST_ESTIMATES,
  HETZNER_COST_ESTIMATES,
  BUILT_IN_IDENTITIES,
} from "@clawup/core";
import type { ClawupManifest, AgentDefinition } from "@clawup/core";

const STEPS = [
  "Stack & Provider",
  "Infrastructure",
  "Owner",
  "Agents",
  "Review",
];

type PresetKey = keyof typeof BUILT_IN_IDENTITIES;

interface WizardState {
  stackName: string;
  provider: "aws" | "hetzner";
  region: string;
  instanceType: string;
  ownerName: string;
  timezone: string;
  workingHours: string;
  selectedAgents: PresetKey[];
}

const initialState: WizardState = {
  stackName: "",
  provider: "aws",
  region: "",
  instanceType: "",
  ownerName: "",
  timezone: "America/New_York",
  workingHours: "9am-6pm",
  selectedAgents: [],
};

// Styles
const s = {
  container: { maxWidth: 720, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" } as const,
  card: { background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", padding: 32 } as const,
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 8 } as const,
  progress: { display: "flex", gap: 8, marginBottom: 32 } as const,
  dot: (active: boolean, done: boolean) => ({
    flex: 1, height: 4, borderRadius: 2,
    background: done ? "#22c55e" : active ? "#3b82f6" : "#e5e7eb",
  }),
  stepLabel: { fontSize: 13, color: "#6b7280", marginBottom: 24 } as const,
  label: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#374151" } as const,
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, marginBottom: 16, boxSizing: "border-box" as const },
  select: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, marginBottom: 16, background: "#fff" },
  btn: (primary: boolean) => ({
    padding: "10px 24px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer",
    background: primary ? "#3b82f6" : "#f3f4f6", color: primary ? "#fff" : "#374151",
  }),
  btnRow: { display: "flex", justifyContent: "space-between", marginTop: 24 } as const,
  error: { color: "#ef4444", fontSize: 13, marginBottom: 8 } as const,
  agentCard: (selected: boolean) => ({
    padding: 16, borderRadius: 8, marginBottom: 8, cursor: "pointer",
    border: `2px solid ${selected ? "#3b82f6" : "#e5e7eb"}`,
    background: selected ? "#eff6ff" : "#fff",
  }),
  reviewRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f3f4f6" } as const,
  reviewLabel: { fontWeight: 600, color: "#6b7280", fontSize: 14 } as const,
  reviewValue: { fontSize: 14, color: "#111827" } as const,
  cost: { fontSize: 20, fontWeight: 700, color: "#22c55e", marginTop: 16, textAlign: "right" as const },
};

export default function NewDeploymentWizard() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof WizardState>(key: K, val: WizardState[K]) =>
    setState((prev) => ({ ...prev, [key]: val }));

  const regions = state.provider === "aws" ? AWS_REGIONS : HETZNER_LOCATIONS;
  const instanceTypes =
    state.provider === "aws"
      ? INSTANCE_TYPES
      : state.region
        ? hetznerServerTypes(state.region)
        : [];

  const costMap = state.provider === "aws" ? COST_ESTIMATES : HETZNER_COST_ESTIMATES;

  function validate(): string[] {
    const errs: string[] = [];
    if (step === 0) {
      if (!state.stackName.trim()) errs.push("Stack name is required");
      if (!/^[a-z0-9-]+$/.test(state.stackName)) errs.push("Stack name: lowercase letters, numbers, hyphens only");
    }
    if (step === 1) {
      if (!state.region) errs.push("Region is required");
      if (!state.instanceType) errs.push("Instance type is required");
    }
    if (step === 2) {
      if (!state.ownerName.trim()) errs.push("Owner name is required");
    }
    if (step === 3) {
      if (state.selectedAgents.length === 0) errs.push("Select at least one agent");
    }
    return errs;
  }

  function next() {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setErrors([]);
    setStep((s) => Math.max(s - 1, 0));
  }

  function toggleAgent(key: PresetKey) {
    setState((prev) => ({
      ...prev,
      selectedAgents: prev.selectedAgents.includes(key)
        ? prev.selectedAgents.filter((k) => k !== key)
        : [...prev.selectedAgents, key],
    }));
  }

  function buildManifest(): ClawupManifest {
    const agents: AgentDefinition[] = state.selectedAgents.map((key) => {
      const identity = BUILT_IN_IDENTITIES[key];
      const [displayName] = identity.label.split(" (");
      return {
        name: key,
        displayName,
        role: key,
        identity: identity.path,
        volumeSize: 30,
      };
    });
    return {
      stackName: state.stackName,
      provider: state.provider,
      region: state.region,
      instanceType: state.instanceType,
      ownerName: state.ownerName,
      timezone: state.timezone,
      workingHours: state.workingHours,
      agents,
    };
  }

  function totalCost(): number {
    const perInstance = costMap[state.instanceType] ?? 0;
    return perInstance * state.selectedAgents.length;
  }

  async function handleSubmit() {
    setSubmitting(true);
    const manifest = buildManifest();
    try {
      const res = await fetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manifest),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("Deployment created:", manifest);
      alert("Deployment created! Check the dashboard.");
    } catch (err) {
      console.error("Submit error:", err);
      setErrors(["Failed to create deployment. Please try again."]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={s.container}>
      <h1 style={s.h1}>New Deployment</h1>
      <div style={s.progress}>
        {STEPS.map((_, i) => (
          <div key={i} style={s.dot(i === step, i < step)} />
        ))}
      </div>
      <div style={s.stepLabel}>
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </div>
      <div style={s.card}>
        {errors.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {errors.map((e, i) => (
              <div key={i} style={s.error}>{e}</div>
            ))}
          </div>
        )}

        {/* Step 1: Stack & Provider */}
        {step === 0 && (
          <>
            <label style={s.label}>Stack Name</label>
            <input
              style={s.input}
              placeholder="my-project"
              value={state.stackName}
              onChange={(e) => update("stackName", e.target.value)}
            />
            <label style={s.label}>Cloud Provider</label>
            <select
              style={s.select}
              value={state.provider}
              onChange={(e) => {
                update("provider", e.target.value as "aws" | "hetzner");
                update("region", "");
                update("instanceType", "");
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.hint}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Step 2: Infrastructure */}
        {step === 1 && (
          <>
            <label style={s.label}>
              {state.provider === "aws" ? "Region" : "Location"}
            </label>
            <select
              style={s.select}
              value={state.region}
              onChange={(e) => {
                update("region", e.target.value);
                update("instanceType", "");
              }}
            >
              <option value="">Select...</option>
              {regions.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <label style={s.label}>Instance Type</label>
            <select
              style={s.select}
              value={state.instanceType}
              onChange={(e) => update("instanceType", e.target.value)}
            >
              <option value="">Select...</option>
              {instanceTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </>
        )}

        {/* Step 3: Owner */}
        {step === 2 && (
          <>
            <label style={s.label}>Your Name</label>
            <input
              style={s.input}
              placeholder="Jane Doe"
              value={state.ownerName}
              onChange={(e) => update("ownerName", e.target.value)}
            />
            <label style={s.label}>Timezone</label>
            <input
              style={s.input}
              placeholder="America/New_York"
              value={state.timezone}
              onChange={(e) => update("timezone", e.target.value)}
            />
            <label style={s.label}>Working Hours</label>
            <input
              style={s.input}
              placeholder="9am-6pm"
              value={state.workingHours}
              onChange={(e) => update("workingHours", e.target.value)}
            />
          </>
        )}

        {/* Step 4: Agents */}
        {step === 3 && (
          <>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 16 }}>
              Select the agents you want to deploy:
            </p>
            {(Object.keys(BUILT_IN_IDENTITIES) as PresetKey[]).map((key) => {
              const identity = BUILT_IN_IDENTITIES[key];
              const selected = state.selectedAgents.includes(key);
              return (
                <div
                  key={key}
                  style={s.agentCard(selected)}
                  onClick={() => toggleAgent(key)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      readOnly
                      style={{ width: 18, height: 18 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {identity.label}
                      </div>
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                        {identity.hint}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Step 5: Review */}
        {step === 4 && (
          <>
            {[
              ["Stack Name", state.stackName],
              ["Provider", state.provider.toUpperCase()],
              ["Region", state.region],
              ["Instance Type", state.instanceType],
              ["Owner", state.ownerName],
              ["Timezone", state.timezone],
              ["Working Hours", state.workingHours],
              ["Agents", state.selectedAgents.map((k) => BUILT_IN_IDENTITIES[k].label).join(", ")],
            ].map(([label, value]) => (
              <div key={label} style={s.reviewRow}>
                <span style={s.reviewLabel}>{label}</span>
                <span style={s.reviewValue}>{value}</span>
              </div>
            ))}
            <div style={s.cost}>
              Est. ~${totalCost()}/mo
            </div>
          </>
        )}

        {/* Navigation */}
        <div style={s.btnRow}>
          <button
            style={s.btn(false)}
            onClick={back}
            disabled={step === 0}
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button style={s.btn(true)} onClick={next}>
              Next →
            </button>
          ) : (
            <button
              style={s.btn(true)}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Deploying..." : "🚀 Deploy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
