import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Clawup — The secure golden path for OpenClaw agent swarms";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #16213e 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "#F83929",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "36px",
            }}
          >
            🦞
          </div>
          <span
            style={{
              fontSize: "48px",
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-1px",
            }}
          >
            Clawup
          </span>
        </div>
        <div
          style={{
            fontSize: "36px",
            fontWeight: 700,
            color: "#e0e0e0",
            lineHeight: 1.3,
            marginBottom: "24px",
            maxWidth: "900px",
          }}
        >
          The secure golden path for deploying OpenClaw agent swarms
        </div>
        <div
          style={{
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          {["Identity-driven", "Infrastructure-as-code", "Zero public ports"].map(
            (tag) => (
              <div
                key={tag}
                style={{
                  padding: "8px 20px",
                  borderRadius: "9999px",
                  border: "1px solid rgba(248, 57, 41, 0.5)",
                  background: "rgba(248, 57, 41, 0.1)",
                  color: "#FCA5A5",
                  fontSize: "20px",
                  fontWeight: 500,
                }}
              >
                {tag}
              </div>
            )
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
