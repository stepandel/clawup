"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface DeploymentSummary {
  id: string;
  stackName: string;
  status: string;
  errorMessage: string | null;
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
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 } as const,
  h1: { fontSize: 28, fontWeight: 700 } as const,
  btn: { padding: "10px 24px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#3b82f6", color: "#fff", textDecoration: "none" } as const,
  btnSecondary: { padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, cursor: "pointer", background: "#f3f4f6", color: "#374151" } as const,
  card: { background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", padding: 20, marginBottom: 12, cursor: "pointer", transition: "box-shadow 0.2s" } as const,
  cardRow: { display: "flex", justifyContent: "space-between", alignItems: "center" } as const,
  stackName: { fontSize: 18, fontWeight: 600 } as const,
  meta: { fontSize: 13, color: "#6b7280", marginTop: 4 } as const,
  badge: (status: string) => ({
    display: "inline-block", padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 600,
    background: (statusColors[status] || "#6b7280") + "20",
    color: statusColors[status] || "#6b7280",
  }),
  empty: { textAlign: "center" as const, padding: 60, color: "#6b7280" },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  signout: { fontSize: 13, color: "#6b7280", cursor: "pointer", background: "none", border: "none", textDecoration: "underline" } as const,
};

export default function DashboardPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetch("/api/deployments")
      .then((r) => r.json())
      .then((data) => setDeployments(data.deployments || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [authStatus]);

  const refresh = () => {
    setLoading(true);
    fetch("/api/deployments")
      .then((r) => r.json())
      .then((data) => setDeployments(data.deployments || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  if (authStatus === "loading" || loading) {
    return (
      <div style={s.container}>
        <p style={{ color: "#6b7280" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Deployments</h1>
          <p style={s.meta}>Welcome, {session?.user?.name || session?.user?.email}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={s.btnSecondary} onClick={refresh}>↻ Refresh</button>
          <a href="/dashboard/new" style={s.btn}>+ New Deployment</a>
          <button style={s.signout} onClick={() => router.push("/api/auth/signout")}>Sign out</button>
        </div>
      </div>

      {deployments.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>🚀</div>
          <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No deployments yet</p>
          <p style={{ marginBottom: 24 }}>Deploy your first fleet of AI agents.</p>
          <a href="/dashboard/new" style={s.btn}>Create Deployment</a>
        </div>
      ) : (
        deployments.map((d) => (
          <div
            key={d.id}
            style={s.card}
            onClick={() => router.push(`/dashboard/${d.id}`)}
          >
            <div style={s.cardRow}>
              <div>
                <div style={s.stackName}>{d.stackName}</div>
                <div style={s.meta}>
                  {d.credential.provider.toUpperCase()} · {d.credential.label} · Created {new Date(d.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span style={s.badge(d.status)}>{d.status}</span>
            </div>
            {d.errorMessage && (
              <div style={{ fontSize: 13, color: "#ef4444", marginTop: 8 }}>{d.errorMessage}</div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
