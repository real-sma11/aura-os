// Provider-tagged error helpers used by the changelog-media pipeline so
// that "credit balance is low" failures clearly identify which third
// party (Anthropic, OpenAI, or Browser Use) needs a top-up. CI logs
// across the pipeline all funnel through `error.message`, so the prefix
// and env-var hint produced here are what an operator actually sees.

export const API_CREDIT_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    consoleUrl: "https://console.anthropic.com/settings/billing",
    creditPatterns: Object.freeze([
      /credit balance is too low/i,
      /your account has insufficient/i,
      /billing[^\n]{0,40}(not enabled|required)/i,
    ]),
  }),
  openai: Object.freeze({
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    consoleUrl: "https://platform.openai.com/settings/organization/billing/overview",
    creditPatterns: Object.freeze([
      /insufficient_quota/i,
      /exceeded your current quota/i,
      /please (add|check) your billing/i,
    ]),
  }),
  "browser-use": Object.freeze({
    name: "Browser Use",
    envVar: "BROWSER_USE_API_KEY",
    consoleUrl: "https://cloud.browser-use.com/billing",
    creditPatterns: Object.freeze([
      /you need at least \$[\d.,]+ in credits/i,
      /current balance:\s*\$[\d.,]+/i,
      /insufficient credits/i,
    ]),
  }),
});

function providerInfo(provider) {
  return API_CREDIT_PROVIDERS[provider] || null;
}

function providerName(provider) {
  return providerInfo(provider)?.name || provider;
}

export function isApiCreditError(provider, value) {
  const info = providerInfo(provider);
  if (!info) return false;
  const haystack = typeof value === "string" ? value : String(value?.message || value || "");
  if (!haystack) return false;
  return info.creditPatterns.some((pattern) => pattern.test(haystack));
}

export function formatApiCreditMessage(provider, detail = "") {
  const info = providerInfo(provider);
  const name = info?.name || provider;
  const envVar = info?.envVar || "";
  const consoleUrl = info?.consoleUrl || "";
  const trimmed = String(detail || "").trim();
  const suffix = trimmed ? `: ${trimmed}` : "";
  const envFragment = envVar ? ` (top up the account tied to ${envVar}` : "";
  const urlFragment = envVar && consoleUrl ? ` — ${consoleUrl})` : envVar ? ")" : "";
  return `[${name}] credit balance is too low${envFragment}${urlFragment}${suffix}`;
}

export function describeApiHttpFailure(provider, {
  status = null,
  body = "",
  contextLabel = "request",
} = {}) {
  const name = providerName(provider);
  const trimmedBody = String(body || "").trim();
  if (isApiCreditError(provider, trimmedBody)) {
    return formatApiCreditMessage(provider, trimmedBody.slice(0, 500));
  }
  const statusFragment = status ? ` (HTTP ${status})` : "";
  const bodyFragment = trimmedBody ? `: ${trimmedBody.slice(0, 500)}` : "";
  return `[${name}] ${contextLabel} failed${statusFragment}${bodyFragment}`;
}

export function wrapProviderError(provider, error, { contextLabel = "request" } = {}) {
  const original = error instanceof Error ? error : new Error(String(error));
  const name = providerName(provider);
  const haystack = `${original.message || ""}\n${original.stack || ""}`;
  if (isApiCreditError(provider, haystack)) {
    const wrapped = new Error(formatApiCreditMessage(provider, original.message));
    wrapped.cause = original;
    wrapped.provider = provider;
    wrapped.providerCreditError = true;
    return wrapped;
  }
  const tag = `[${name}]`;
  if (original.message && original.message.startsWith(tag)) {
    return original;
  }
  const detail = original.message?.trim();
  const wrapped = new Error(`${tag} ${contextLabel} failed${detail ? `: ${detail}` : ""}`);
  wrapped.cause = original;
  wrapped.provider = provider;
  return wrapped;
}
