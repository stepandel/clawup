# Task: Fix All E2E Tests

## Problem
All E2E tests fail because `getWorkspaceDir()` from `packages/cli/lib/workspace.ts` returns a project-mode path (`tempDir/.clawup/`) instead of `undefined` (dev mode). This happens because:

1. `getCliPackageRoot()` uses `__dirname` which resolves to `packages/cli/lib/` in vitest
2. `isDevMode()` checks `path.resolve(getCliPackageRoot(), "..")` → `packages/` — not the monorepo root
3. `packages/Pulumi.yaml` doesn't exist → `isDevMode()` returns false
4. Falls through to project mode → `findProjectRoot()` returns `tempDir` (mocked)
5. `getWorkspaceDir()` returns `tempDir/.clawup/` which has no `Pulumi.yaml` or `Pulumi SDK`
6. `selectOrCreateStack()` runs `pulumi stack init` in `tempDir/.clawup/` → fails

## The Fix

The E2E tests already mock `../lib/project`. They also need to mock `../lib/workspace` to ensure:
- `getWorkspaceDir()` returns `undefined` (dev mode behavior — Pulumi runs from repo root)
- `ensureWorkspace()` returns `{ ok: true }`
- `isDevMode()` returns `true`

### Files to fix:

1. **`packages/cli/__e2e__/lifecycle.e2e.test.ts`** — Add workspace mock
2. **`packages/cli/__e2e__/plugins.e2e.test.ts`** — Add workspace mock + LINEAR_USER_UUID env line
3. **`packages/cli/__e2e__/redeploy.e2e.test.ts`** — Add workspace mock
4. **`packages/cli/__e2e__/error-cases.e2e.test.ts`** — Fix TestCancelError vs ProcessExitError (deploy/destroy now call process.exit instead of throwing cancel errors; update the tests to expect ProcessExitError or update the cancel handling)

### Workspace mock pattern to add (BEFORE the `@clack/prompts` mock, alongside the project mock):

```typescript
vi.mock("../lib/workspace", () => ({
  getWorkspaceDir: vi.fn(() => undefined),
  ensureWorkspace: vi.fn(() => ({ ok: true })),
  isDevMode: vi.fn(() => true),
}));
```

### For error-cases.e2e.test.ts:

The "throws TestCancelError when user declines" tests expect `TestCancelError` but `deploy` and `destroy` call `process.exit(1)` when the user cancels (via `isCancel` check). The mock for `@clack/prompts` has `isCancel: () => false`, but the test adapter's `confirm` returns false to simulate cancellation. 

Check how `deployTool` and `destroyTool` handle confirmation rejection — they likely call `exitWithError` or `process.exit(1)`. Update the test expectations to match the actual behavior (expect `ProcessExitError` with code 1 instead of `TestCancelError`).

### For plugins.e2e.test.ts:

Add `PLUGINTESTER_LINEAR_USER_UUID=fake-uuid-for-e2e` to the extraEnvLines to bypass the Linear API auto-resolve call.

## Verification

After fixes:
1. `pnpm --filter @clawup/core build` must succeed
2. All 176 unit tests pass: `pnpm test`
3. All E2E tests pass: `PATH=$HOME/.pulumi/bin:$PATH PULUMI_CONFIG_PASSPHRASE=test PULUMI_SKIP_UPDATE_CHECK=true pnpm exec vitest run --config packages/cli/__e2e__/vitest.e2e.config.ts`
4. Commit with: `fix: resolve workspace mock and env issues in E2E tests`
5. Do NOT push

## Important
- Pulumi is installed at `$HOME/.pulumi/bin` — ensure PATH includes it
- Pulumi is logged in locally (`pulumi login --local` was run)
- Docker is available and running
- The E2E tests take ~60s total and run sequentially
- Don't modify source code — only fix test files
