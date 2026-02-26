# Task: Fix E2E Tests — Precise Instructions

## Root Cause Analysis (verified)

The E2E tests fail because of a chain of workspace/path issues:

1. **`isDevMode()` returns false in vitest** — because `getCliPackageRoot()` resolves `__dirname` to `packages/cli/lib/`, then `../` = `packages/cli/`, then `../` = `packages/` — not the monorepo root. So `packages/Pulumi.yaml` doesn't exist → not dev mode.

2. **In non-dev mode (project mode)**, `getWorkspaceDir()` returns `<tempDir>/.clawup/` — but that directory has no Pulumi.yaml or infra files.

3. **Pulumi.yaml references `main: packages/pulumi/dist/index.js`** — a path relative to repo root. When Pulumi runs from any other directory, this path breaks.

4. **The Pulumi program (`index.ts:89`) uses `process.cwd()` to find `clawup.yaml`** — in dev mode CWD = repo root, but test's clawup.yaml is in tempDir.

## The Fix (two-part)

### Part 1: Update Pulumi program to find clawup.yaml in parent dir too

In `packages/pulumi/src/index.ts`, change the manifest path resolution to also check the parent directory (for project mode where Pulumi.yaml is in `.clawup/` but clawup.yaml is in the project root):

```typescript
// Pulumi sets cwd to where Pulumi.yaml lives
// Dev mode: repo root (clawup.yaml is also here)  
// Project mode: <projectRoot>/.clawup/ (clawup.yaml is in parent)
let manifestPath = path.join(process.cwd(), "clawup.yaml");
if (!fs.existsSync(manifestPath)) {
  manifestPath = path.join(process.cwd(), "..", "clawup.yaml");
}
if (!fs.existsSync(manifestPath)) {
  throw new Error("clawup.yaml not found. Run `clawup init` to create it.");
}
```

After changing, rebuild: `pnpm --filter @clawup/pulumi build`

### Part 2: Fix E2E test files

For ALL 4 test files in `packages/cli/__e2e__/`:

#### a) Add workspace mock (lifecycle, plugins, redeploy — NOT error-cases)

After the existing `vi.mock("../lib/project", ...)` block, add:

```typescript
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => {
    // Return tempDir/.clawup in project mode
    // tempDir is set in beforeAll, but mock is evaluated at import time
    // so we use a getter that defers to the variable
    return tempDir ? path.join(tempDir, ".clawup") : undefined;
  }),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => false),
}));
```

WAIT — vi.mock hoists, so `tempDir` won't be available. Instead, use a module-level ref:

```typescript
// At top of file, after other state variables
let workspaceDir: string | undefined;

// In the mock (before imports):
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => workspaceDir),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => false),
}));
```

Then in `beforeAll`, after `tempDir` is set:
```typescript
workspaceDir = path.join(tempDir, ".clawup");
```

#### b) Set up workspace directory in beforeAll (lifecycle, plugins, redeploy)

After `tempDir` is created in beforeAll, add:

```typescript
// Set up workspace for project mode
workspaceDir = path.join(tempDir, ".clawup");
fs.mkdirSync(workspaceDir, { recursive: true });

// Copy Pulumi.yaml with corrected main path
const repoRoot = path.resolve(__dirname, "../../..");
const pulumiYaml = fs.readFileSync(path.join(repoRoot, "Pulumi.yaml"), "utf-8");
// Rewrite main path: since workspace is at tempDir/.clawup, and the actual
// dist is at repoRoot/packages/pulumi/dist, use absolute path
fs.writeFileSync(
  path.join(workspaceDir, "Pulumi.yaml"),
  pulumiYaml.replace(
    /^main:.*$/m,
    `main: ${path.join(repoRoot, "packages/pulumi/dist/index.js")}`
  ),
  "utf-8"
);

// Install Pulumi SDK in workspace (needed for pulumi to find @pulumi/pulumi)
// Symlink node_modules from repo root
fs.symlinkSync(
  path.join(repoRoot, "node_modules"),
  path.join(workspaceDir, "node_modules"),
  "dir"
);
```

#### c) Add PULUMI_BACKEND_URL env var (lifecycle, plugins, redeploy)

In beforeAll, after setting PULUMI_CONFIG_PASSPHRASE:
```typescript
process.env.PULUMI_BACKEND_URL = "file://~";
```

In afterAll:
```typescript
delete process.env.PULUMI_BACKEND_URL;
```

#### d) Add LINEAR_USER_UUID to plugins test

In `plugins.e2e.test.ts`, add to the `extraEnvLines` array:
```
"PLUGINTESTER_LINEAR_USER_UUID=fake-uuid-for-e2e",
```

#### e) Fix error-cases.e2e.test.ts cancel expectations

Change both "throws TestCancelError when user declines" tests:
- Deploy cancel: `rejects.toThrow(TestCancelError)` → `rejects.toThrow(ProcessExitError)`
- Destroy cancel: `rejects.toThrow(TestCancelError)` → `rejects.toThrow(ProcessExitError)`

Also add workspace mock to error-cases.e2e.test.ts (same pattern but simpler since it doesn't need beforeAll setup).

### Redeploy test specifics

The `redeploy.e2e.test.ts` has TWO describe blocks, each with their own `beforeAll`. Both need the workspace setup.

## Verification

1. `pnpm --filter @clawup/core build` — must succeed
2. `pnpm --filter @clawup/pulumi build` — must succeed (after index.ts change)
3. `pnpm test` — all 176 unit tests pass
4. `PATH=$HOME/.pulumi/bin:$PATH PULUMI_CONFIG_PASSPHRASE=test PULUMI_SKIP_UPDATE_CHECK=true pnpm exec vitest run --config packages/cli/__e2e__/vitest.e2e.config.ts` — all 24 E2E tests pass
5. Commit: `fix: resolve E2E test workspace and Pulumi path issues`
6. Do NOT push

## Key Files
- `packages/pulumi/src/index.ts` — manifest path fix
- `packages/cli/__e2e__/lifecycle.e2e.test.ts`
- `packages/cli/__e2e__/plugins.e2e.test.ts`
- `packages/cli/__e2e__/redeploy.e2e.test.ts`
- `packages/cli/__e2e__/error-cases.e2e.test.ts`
