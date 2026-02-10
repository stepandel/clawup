import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  return (
    <div style={{ maxWidth: "800px", margin: "100px auto", padding: "20px" }}>
      <h1>Dashboard</h1>
      <p>Welcome, {session.user?.email}!</p>
      {session.user?.name && <p>Name: {session.user.name}</p>}
      <div style={{ marginTop: "20px" }}>
        <a
          href="/api/auth/signout"
          style={{
            padding: "10px 20px",
            backgroundColor: "#f44336",
            color: "white",
            textDecoration: "none",
            borderRadius: "4px",
            display: "inline-block",
          }}
        >
          Logout
        </a>
      </div>
    </div>
  );
}
