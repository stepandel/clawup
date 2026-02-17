import { describe, it, expect } from "vitest";
import { fetchIdentity } from "../identity";
import * as path from "path";
import * as os from "os";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cacheDir = path.join(os.tmpdir(), "identity-test-cache");

describe("extracted identity presets", () => {
  for (const role of ["pm", "eng", "tester"]) {
    describe(role, () => {
      it("has a valid identity.json", async () => {
        const identityPath = path.join(repoRoot, "identities", role);
        const result = await fetchIdentity(identityPath, cacheDir);

        expect(result.manifest.name).toBe(role);
        expect(result.manifest.role).toBe(role);
        expect(result.manifest.displayName).toBeTruthy();
        expect(result.manifest.emoji).toBeTruthy();
        expect(result.manifest.description).toBeTruthy();
        expect(result.manifest.volumeSize).toBeGreaterThan(0);
        expect(result.manifest.skills.length).toBeGreaterThan(0);
        expect(result.manifest.templateVars.length).toBeGreaterThan(0);
      });

      it("includes workspace files", async () => {
        const identityPath = path.join(repoRoot, "identities", role);
        const result = await fetchIdentity(identityPath, cacheDir);

        expect(result.files["SOUL.md"]).toBeTruthy();
        expect(result.files["IDENTITY.md"]).toBeTruthy();
        expect(result.files["AGENTS.md"]).toBeTruthy();
      });

      it("includes skills", async () => {
        const identityPath = path.join(repoRoot, "identities", role);
        const result = await fetchIdentity(identityPath, cacheDir);

        const skillFiles = Object.keys(result.files).filter(f => f.startsWith("skills/"));
        expect(skillFiles.length).toBeGreaterThan(0);
      });

      it("has linearRouting defined", async () => {
        const identityPath = path.join(repoRoot, "identities", role);
        const result = await fetchIdentity(identityPath, cacheDir);

        expect(result.manifest.linearRouting).toBeDefined();
        expect(result.manifest.linearRouting!.add).toBeDefined();
        expect(result.manifest.linearRouting!.remove).toBeDefined();
      });
    });
  }
});
