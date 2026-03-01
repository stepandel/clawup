/**
 * Redact likely-secret values from a string before printing to console/logs.
 *
 * This is intentionally conservative: onboard hooks may echo tokens/secrets in
 * instructions, and we don't want to leak them in CLI output.
 */
export function redactSecretsFromString(input: string): string {
  if (!input) return input;

  // Redact common KEY=VALUE patterns.
  const keyValue =
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|KEY|PASS|PASSWORD)[A-Z0-9_]*)\b\s*=\s*(?:"[^"]*"|'[^']*'|[^\s\n\r]+)/gi;
  let out = input.replace(keyValue, (_m, key) => `${key}=[REDACTED]`);

  // Redact common Slack/GitHub/Linear token formats when they appear anywhere.
  // (This is best-effort; add more patterns as needed.)
  const tokenPatterns: Array<[RegExp, string]> = [
    [/\bxoxb-[0-9A-Za-z-]+\b/g, "xoxb-[REDACTED]"],
    [/\bxapp-[0-9A-Za-z-]+\b/g, "xapp-[REDACTED]"],
    [/\bxoxe-[0-9A-Za-z-]+\b/g, "xoxe-[REDACTED]"],
    [/\blin_api_[0-9A-Za-z]+\b/g, "lin_api_[REDACTED]"],
    [/\bghp_[0-9A-Za-z]{20,}\b/g, "ghp_[REDACTED]"],
    [/\bsk-[0-9A-Za-z]{20,}\b/g, "sk-[REDACTED]"],
  ];

  for (const [re, replacement] of tokenPatterns) {
    out = out.replace(re, replacement);
  }

  return out;
}
