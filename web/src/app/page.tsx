"use client";
export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "#e5e5e5",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Hero Section */}
      <section
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "120px 40px 80px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "4rem",
            fontWeight: "700",
            marginBottom: "20px",
            background: "linear-gradient(135deg, #ffffff 0%, #888888 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Agent Army
        </h1>
        <p
          style={{
            fontSize: "1.5rem",
            color: "#a3a3a3",
            maxWidth: "800px",
            margin: "0 auto",
            lineHeight: "1.6",
          }}
        >
          Deploy a fleet of specialized AI agents on AWS or Hetzner Cloud — managed entirely from your terminal.
        </p>
      </section>

      {/* Quick Start Section */}
      <section
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "60px 40px",
        }}
      >
        <h2
          style={{
            fontSize: "2.5rem",
            fontWeight: "600",
            marginBottom: "40px",
            textAlign: "center",
          }}
        >
          Quick Start
        </h2>
        <div
          style={{
            backgroundColor: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: "12px",
            padding: "40px",
            maxWidth: "800px",
            margin: "0 auto",
          }}
        >
          <div style={{ marginBottom: "30px" }}>
            <h3
              style={{
                fontSize: "1.2rem",
                color: "#d4d4d4",
                marginBottom: "12px",
                fontWeight: "500",
              }}
            >
              1. Install the CLI
            </h3>
            <code
              style={{
                display: "block",
                backgroundColor: "#0a0a0a",
                padding: "16px 20px",
                borderRadius: "8px",
                fontSize: "0.95rem",
                color: "#10b981",
                border: "1px solid #262626",
                fontFamily: "monospace",
              }}
            >
              npm install -g @agent-army/cli
            </code>
          </div>

          <div style={{ marginBottom: "30px" }}>
            <h3
              style={{
                fontSize: "1.2rem",
                color: "#d4d4d4",
                marginBottom: "12px",
                fontWeight: "500",
              }}
            >
              2. Run the Setup Wizard
            </h3>
            <code
              style={{
                display: "block",
                backgroundColor: "#0a0a0a",
                padding: "16px 20px",
                borderRadius: "8px",
                fontSize: "0.95rem",
                color: "#10b981",
                border: "1px solid #262626",
                fontFamily: "monospace",
              }}
            >
              agent-army init
            </code>
          </div>

          <div>
            <h3
              style={{
                fontSize: "1.2rem",
                color: "#d4d4d4",
                marginBottom: "12px",
                fontWeight: "500",
              }}
            >
              3. Deploy Your Team
            </h3>
            <code
              style={{
                display: "block",
                backgroundColor: "#0a0a0a",
                padding: "16px 20px",
                borderRadius: "8px",
                fontSize: "0.95rem",
                color: "#10b981",
                border: "1px solid #262626",
                fontFamily: "monospace",
              }}
            >
              agent-army deploy
            </code>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "60px 40px",
        }}
      >
        <h2
          style={{
            fontSize: "2.5rem",
            fontWeight: "600",
            marginBottom: "40px",
            textAlign: "center",
          }}
        >
          Meet Your Team
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "30px",
          }}
        >
          {/* Juno - PM */}
          <div
            style={{
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "12px",
              padding: "30px",
            }}
          >
            <h3
              style={{
                fontSize: "1.8rem",
                marginBottom: "10px",
                color: "#ffffff",
              }}
            >
              Juno
            </h3>
            <p
              style={{
                fontSize: "1rem",
                color: "#6b7280",
                marginBottom: "15px",
                fontWeight: "500",
              }}
            >
              Product Manager
            </p>
            <p
              style={{
                fontSize: "1rem",
                color: "#a3a3a3",
                lineHeight: "1.6",
              }}
            >
              Breaks down tickets, researches requirements, plans and sequences work, tracks progress, and unblocks teams.
            </p>
          </div>

          {/* Titus - Engineer */}
          <div
            style={{
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "12px",
              padding: "30px",
            }}
          >
            <h3
              style={{
                fontSize: "1.8rem",
                marginBottom: "10px",
                color: "#ffffff",
              }}
            >
              Titus
            </h3>
            <p
              style={{
                fontSize: "1rem",
                color: "#6b7280",
                marginBottom: "15px",
                fontWeight: "500",
              }}
            >
              Engineer
            </p>
            <p
              style={{
                fontSize: "1rem",
                color: "#a3a3a3",
                lineHeight: "1.6",
              }}
            >
              Picks up tickets, writes code via Claude Code, builds and tests, creates PRs, and responds to reviews.
            </p>
          </div>

          {/* Scout - QA */}
          <div
            style={{
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "12px",
              padding: "30px",
            }}
          >
            <h3
              style={{
                fontSize: "1.8rem",
                marginBottom: "10px",
                color: "#ffffff",
              }}
            >
              Scout
            </h3>
            <p
              style={{
                fontSize: "1rem",
                color: "#6b7280",
                marginBottom: "15px",
                fontWeight: "500",
              }}
            >
              QA Tester
            </p>
            <p
              style={{
                fontSize: "1rem",
                color: "#a3a3a3",
                lineHeight: "1.6",
              }}
            >
              Reviews PRs, tests happy/sad/edge cases, files bugs, and verifies fixes.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid `#262626`",
          marginTop: "80px",
          padding: "40px",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            justifyContent: "center",
            gap: "40px",
            flexWrap: "wrap",
          }}
        >
          <a
            href="https://github.com/stepandel/agent-army"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#a3a3a3",
              textDecoration: "none",
              fontSize: "1rem",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#a3a3a3")}
          >
            GitHub
          </a>
          <a
            href="https://github.com/stepandel/agent-army#readme"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#a3a3a3",
              textDecoration: "none",
              fontSize: "1rem",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#a3a3a3")}
          >
            Documentation
          </a>
          <a
            href="https://openclaw.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#a3a3a3",
              textDecoration: "none",
              fontSize: "1rem",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#a3a3a3")}
          >
            OpenClaw
          </a>
        </div>
        <p
          style={{
            textAlign: "center",
            color: "#6b7280",
            fontSize: "0.875rem",
            marginTop: "30px",
          }}
        >
          Powered by OpenClaw AI agents
        </p>
      </footer>
    </div>
  );
}
