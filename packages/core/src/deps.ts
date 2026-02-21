/**
 * Dep resolution utilities — resolves dep names to registry entries
 * and collects the secret env vars they need.
 */

import { DEP_REGISTRY, DepRegistryEntry } from "./dep-registry";

export interface ResolvedDep {
  name: string;
  entry: DepRegistryEntry;
}

/** Resolve dep names to registry entries. Throws on unknown deps. */
export function resolveDeps(depNames: string[]): ResolvedDep[] {
  return depNames.map((name) => {
    const entry = DEP_REGISTRY[name];
    if (!entry) {
      const known = Object.keys(DEP_REGISTRY).join(", ");
      throw new Error(
        `Unknown dep "${name}". Known deps: ${known}`
      );
    }
    return { name, entry };
  });
}

/** Collect all secret env vars needed by a set of deps. */
export function collectDepSecrets(
  deps: ResolvedDep[]
): { envVar: string; scope: "agent" | "global"; configKeySuffix: string }[] {
  const secrets: { envVar: string; scope: "agent" | "global"; configKeySuffix: string }[] = [];
  const seen = new Set<string>();

  for (const dep of deps) {
    for (const [suffix, secret] of Object.entries(dep.entry.secrets)) {
      if (!seen.has(secret.envVar)) {
        seen.add(secret.envVar);
        secrets.push({
          envVar: secret.envVar,
          scope: secret.scope,
          configKeySuffix: suffix,
        });
      }
    }
  }

  return secrets;
}
