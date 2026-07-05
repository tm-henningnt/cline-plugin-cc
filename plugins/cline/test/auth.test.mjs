import { test } from "node:test";
import assert from "node:assert/strict";
import { selectClineAuth } from "../scripts/lib/auth.mjs";

const EMPTY_AUTH = { token: "", accountId: "", model: null, provider: null, clinePassModel: null };

test("selectClineAuth: active provider with token wins", () => {
  assert.deepEqual(
    selectClineAuth({
      lastUsedProvider: "cline-pass",
      providers: {
        "cline-pass": {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-active", accountId: "usr-EXAMPLE-active" },
            model: "cline-pass/glm-5.2",
            provider: "cline-pass",
          },
        },
        cline: {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-cline", accountId: "usr-EXAMPLE-cline" },
            model: "anthropic/claude-sonnet-4.6",
            provider: "cline",
          },
        },
      },
    }),
    {
      token: "tok-EXAMPLE-active",
      accountId: "usr-EXAMPLE-active",
      model: "cline-pass/glm-5.2",
      provider: "cline-pass",
      clinePassModel: "cline-pass/glm-5.2",
    },
  );
});

test("selectClineAuth: cline-pass wins over cline when no active provider is set", () => {
  assert.deepEqual(
    selectClineAuth({
      providers: {
        cline: {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-cline", accountId: "usr-EXAMPLE-cline" },
            model: "anthropic/claude-sonnet-4.6",
            provider: "cline",
          },
        },
        "cline-pass": {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-pass", accountId: "usr-EXAMPLE-pass" },
            model: "cline-pass/kimi-k2.7-code",
            provider: "cline-pass",
          },
        },
      },
    }),
    {
      token: "tok-EXAMPLE-pass",
      accountId: "usr-EXAMPLE-pass",
      model: "cline-pass/kimi-k2.7-code",
      provider: "cline-pass",
      clinePassModel: "cline-pass/kimi-k2.7-code",
    },
  );
});

test("selectClineAuth: cline-pass settings without model reports null run model", () => {
  assert.deepEqual(
    selectClineAuth({
      lastUsedProvider: "cline",
      providers: {
        cline: {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-cline", accountId: "usr-EXAMPLE-cline" },
            model: "anthropic/claude-sonnet-4.6",
            provider: "cline",
          },
        },
        "cline-pass": {
          settings: {
            provider: "cline-pass",
          },
        },
      },
    }),
    {
      token: "tok-EXAMPLE-cline",
      accountId: "usr-EXAMPLE-cline",
      model: "anthropic/claude-sonnet-4.6",
      provider: "cline",
      clinePassModel: null,
    },
  );
});

test("selectClineAuth: finds another token-bearing provider as the final fallback", () => {
  assert.deepEqual(
    selectClineAuth({
      providers: {
        anthropic: {
          settings: {
            model: "anthropic/claude-sonnet-4.6",
            provider: "anthropic",
          },
        },
        openrouter: {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-other", accountId: "usr-EXAMPLE-other" },
            model: "openrouter/example",
            provider: "openrouter",
          },
        },
      },
    }),
    {
      token: "tok-EXAMPLE-other",
      accountId: "usr-EXAMPLE-other",
      model: "openrouter/example",
      provider: "openrouter",
      clinePassModel: null,
    },
  );
});

test("selectClineAuth: empty or missing providers returns empty auth", () => {
  assert.deepEqual(selectClineAuth({ providers: {} }), EMPTY_AUTH);
  assert.deepEqual(selectClineAuth({}), EMPTY_AUTH);
  assert.deepEqual(selectClineAuth(null), EMPTY_AUTH);
});

test("selectClineAuth: token-bearing cline-pass auth wins without replacing active display", () => {
  assert.deepEqual(
    selectClineAuth({
      lastUsedProvider: "anthropic",
      providers: {
        anthropic: {
          settings: {
            apiKey: "api-key-EXAMPLE",
            model: "anthropic/claude-sonnet-4.6",
            provider: "anthropic",
          },
        },
        "cline-pass": {
          settings: {
            auth: { accessToken: "tok-EXAMPLE-pass", accountId: "usr-EXAMPLE-pass" },
            model: "cline-pass/glm-5.2",
            provider: "cline-pass",
          },
        },
      },
    }),
    {
      token: "tok-EXAMPLE-pass",
      accountId: "usr-EXAMPLE-pass",
      model: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      clinePassModel: "cline-pass/glm-5.2",
    },
  );
});

test("selectClineAuth: signed-out active settings still provide display fields", () => {
  assert.deepEqual(
    selectClineAuth({
      lastUsedProvider: "anthropic",
      providers: {
        anthropic: {
          settings: {
            apiKey: "api-key-EXAMPLE",
            model: "anthropic/claude-sonnet-4.6",
            provider: "anthropic",
          },
        },
        "cline-pass": {
          settings: {
            model: "cline-pass/glm-5.2",
            provider: "cline-pass",
          },
        },
      },
    }),
    {
      token: "",
      accountId: "",
      model: "anthropic/claude-sonnet-4.6",
      provider: "anthropic",
      clinePassModel: "cline-pass/glm-5.2",
    },
  );
});
