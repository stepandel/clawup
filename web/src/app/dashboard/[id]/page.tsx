"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";

interface DeploymentDetail {
  id: string;
  stackName: string;
  status: string;
  logs: string;
  errorMessage: string | null;
  pulumiStack: string | null;
  createdAt: string;
  updatedAt: string;
  credential: { provider: string; label: string };
}

const statusColors: Record<string, string> = {
  queued: "#f59e0b",
  running: "#3b82f6",
  success: "#22c55e",
  failed: "#ef4444",
};

const s = {
  container: { maxWidth: 900, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" } as const,
  back: { fontSize: 14, color: "#3b82f6", cursor: "pointer", background: "none", border: "none", marginBottom: 16, display: "block" } as const,
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 } as const,
  h1: { fontSize: 28, fontWeight: 700 } as const,
  badge: (status: string) => ({
    display: "inline-block", padding: "6px 16px", borderRadius: 12, fontSize: 13, fontWeight: 600,
    background: (statusColors[status] || "#6b7280") + "20",
    color: statusColors[status] || "#6b7280",
  }),
  card: { background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", padding: 24, marginBottom: 16 } as const,
  cardTitle: { fontSize: 16, fontWeight: 600, marginBottom: 12 } as const,
  row: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f3f4f6" } as const,
  label: { fontWeight: 600, color: "#6b7280", fontSize: 14 } as const,
  value: { fontSize: 14, color: "#111827" } as const,
  logs: { background: "#111827", color: "#e5e7eb", padding: 16, borderRadius: 8, fontSize: 13, fontFamily: "monospace", whiteSpace: "pre-wrap" as const, maxHeight: 400, overflow: "auto" },
  btnDanger: { padding: "10px 24px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#ef4444", color: "#fff" } as const,
  btnSecondary: { padding: "10px 24px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#374151" } as const,
  meta: { fontSize: 13, color: "#6b7280" } as const,
};

export default function DeploymentDetailPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [deployment, setDeployment] = useState<DeploymentDetail | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [destroying, setDestroying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  const fetchDeployment = () => {
    fetch(`/api/deployments/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setDeployment(data.deployment);
        try {
          // Parse manifest from logs or separate field
          if (data.deployment) {
            // Manifest is stored on the deployment but not exposed by default
            // We'd need to add it to the API select - for now show what we have
          }
        } catch {}
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetchDeployment();

    // Auto-refresh if running
    const interval = setInterval(() => {
      if (deployment?.status === "running" || deployment?.status === "queued") {
        fetchDeployment();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [authStatus, id]);

  const handleDestroy = async () => {
    setDestroying(true);
    try {
      const res = await fetch(`/api/deployments/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        alert("Failed to destroy deployment");
      }
    } catch (err) {
      console.error(err);
      alert("Error destroying deployment");
    } finally {
      setDestroying(false);
      setShowConfirm(false);
    }
  };

  if (loading || authStatus === "loading") {
    return <div style={s.container}><p style={s.meta}>Loading...</p></div>;
  }

  if (!deployment) {
    return (
      <div style={s.container}>
        <button style={s.back} onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>
        <p>Deployment not found.</p>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <button style={s.back} onClick={() => router.push("/dashboard")}>← Back to Dashboard</button>

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{deployment.stackName}</h1>
          <p style={s.meta}>
            {deployment.credential.provider.toUpperCase()} · {deployment.credential.label}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={s.badge(deployment.status)}>{deployment.status}</span>
          <button style={s.btnSecondary} onClick={fetchDeployment}>↻ Refresh</button>
        </div>
      </div>

      {/* Details */}
      <div style={s.card}>
        <div style={s.cardTitle}>Deployment Details</div>
        {[
          ["Stack Name", deployment.stackName],
          ["Provider", deployment.credential.provider.toUpperCase()],
          ["Credential", deployment.credential.label],
          ["Status", deployment.status],
          ["Pulumi Stack", deployment.pulumiStack || "—"],
          ["Created", new Date(deployment.createdAt).toLocaleString()],
          ["Updated", new Date(deployment.updatedAt).toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} style={s.row}>
            <span style={s.label}>{label}</span>
            <span style={s.value}>{value}</span>
          </div>
        ))}
        {deployment.errorMessage && (
          <div style={{ marginTop: 12, padding: 12, background: "#fef2f2", borderRadius: 8, color: "#ef4444", fontSize: 14 }}>
            <strong>Error:</strong> {deployment.errorMessage}
          </div>
        )}
      </div>

      {/* Logs */}
      <div style={s.card}>
        <div style={s.cardTitle}>Deployment Logs</div>
        {deployment.logs ? (
          <div style={s.logs}>{deployment.logs}</div>
        ) : (
          <p style={s.meta}>No logs available yet.</p>
        )}
      </div>

      {/* Destroy */}
      <div style={s.card}>
        <div style={s.cardTitle}>Danger Zone</div>
        {!showConfirm ? (
          <button style={s.btnDanger} onClick={() => setShowConfirm(true)}>
            🗑️ Destroy Deployment
          </button>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 12 }}>
              Are you sure? This will permanently destroy all resources for <strong>{deployment.stackName}</strong>.
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={s.btnDanger} onClick={handleDestroy} disabled={destroying}>
                {destroying ? "Destroying..." : "Yes, destroy everything"}
              </button>
              <button style={s.btnSecondary} onClick={() => setShowConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
