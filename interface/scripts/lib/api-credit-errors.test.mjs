import assert from "node:assert/strict";
import test from "node:test";

import {
  API_CREDIT_PROVIDERS,
  describeApiHttpFailure,
  formatApiCreditMessage,
  isApiCreditError,
  wrapProviderError,
} from "./api-credit-errors.mjs";

test("API_CREDIT_PROVIDERS covers anthropic, openai, and browser-use", () => {
  assert.deepEqual(
    Object.keys(API_CREDIT_PROVIDERS).sort(),
    ["anthropic", "browser-use", "openai"],
  );
  for (const info of Object.values(API_CREDIT_PROVIDERS)) {
    assert.ok(info.name, "provider has a display name");
    assert.ok(info.envVar, "provider has an env var to top up");
    assert.ok(info.creditPatterns.length > 0, "provider has at least one credit pattern");
  }
});

test("isApiCreditError matches the Browser Use cloud balance message", () => {
  assert.equal(
    isApiCreditError("browser-use", "You need at least $1.00 in credits. Current balance: $0.34"),
    true,
  );
  assert.equal(isApiCreditError("browser-use", "Request timed out"), false);
});

test("isApiCreditError matches Anthropic's credit-balance wording", () => {
  assert.equal(
    isApiCreditError(
      "anthropic",
      'Anthropic media planning failed with 400: {"error":{"message":"Your credit balance is too low to access the Anthropic API"}}',
    ),
    true,
  );
  assert.equal(isApiCreditError("anthropic", "rate_limit_exceeded"), false);
});

test("isApiCreditError matches OpenAI's insufficient_quota wording", () => {
  assert.equal(
    isApiCreditError("openai", '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'),
    true,
  );
  assert.equal(isApiCreditError("openai", "model_not_found"), false);
});

test("isApiCreditError returns false for unknown providers and empty inputs", () => {
  assert.equal(isApiCreditError("unknown", "you need at least $1 in credits"), false);
  assert.equal(isApiCreditError("openai", ""), false);
  assert.equal(isApiCreditError("openai", null), false);
});

test("formatApiCreditMessage prefixes the provider and names the env var to top up", () => {
  const message = formatApiCreditMessage("browser-use", "You need at least $1.00 in credits. Current balance: $0.34");
  assert.match(message, /^\[Browser Use\] credit balance is too low/);
  assert.match(message, /BROWSER_USE_API_KEY/);
  assert.match(message, /Current balance: \$0\.34/);
});

test("formatApiCreditMessage works without a detail message", () => {
  const message = formatApiCreditMessage("anthropic");
  assert.match(message, /^\[Anthropic\] credit balance is too low/);
  assert.match(message, /ANTHROPIC_API_KEY/);
});

test("describeApiHttpFailure flags credit-low bodies with the provider tag", () => {
  const message = describeApiHttpFailure("anthropic", {
    status: 400,
    body: '{"error":{"message":"Your credit balance is too low to access the Anthropic API"}}',
    contextLabel: "media planning",
  });
  assert.match(message, /^\[Anthropic\] credit balance is too low/);
  assert.match(message, /ANTHROPIC_API_KEY/);
});

test("describeApiHttpFailure falls back to a tagged HTTP error for non-credit failures", () => {
  const message = describeApiHttpFailure("openai", {
    status: 500,
    body: "internal server error",
    contextLabel: "vision quality judge",
  });
  assert.equal(message, "[OpenAI] vision quality judge failed (HTTP 500): internal server error");
});

test("wrapProviderError converts SDK credit errors into a tagged Error", () => {
  const original = new Error("You need at least $1.00 in credits. Current balance: $0.34");
  const wrapped = wrapProviderError("browser-use", original, { contextLabel: "task run" });
  assert.notEqual(wrapped, original);
  assert.equal(wrapped.cause, original);
  assert.equal(wrapped.provider, "browser-use");
  assert.equal(wrapped.providerCreditError, true);
  assert.match(wrapped.message, /^\[Browser Use\] credit balance is too low/);
  assert.match(wrapped.message, /BROWSER_USE_API_KEY/);
});

test("wrapProviderError still tags non-credit errors with the provider name", () => {
  const original = new Error("WebSocket connection reset");
  const wrapped = wrapProviderError("browser-use", original, { contextLabel: "task run" });
  assert.equal(wrapped.cause, original);
  assert.equal(wrapped.provider, "browser-use");
  assert.equal(wrapped.providerCreditError, undefined);
  assert.equal(wrapped.message, "[Browser Use] task run failed: WebSocket connection reset");
});

test("wrapProviderError leaves an already-tagged error unchanged", () => {
  const tagged = new Error("[Browser Use] task run failed: anything");
  const wrapped = wrapProviderError("browser-use", tagged, { contextLabel: "task run" });
  assert.equal(wrapped, tagged);
});

test("wrapProviderError accepts non-Error values", () => {
  const wrapped = wrapProviderError("openai", "insufficient_quota", { contextLabel: "vision quality judge" });
  assert.match(wrapped.message, /^\[OpenAI\] credit balance is too low/);
  assert.match(wrapped.message, /OPENAI_API_KEY/);
});
