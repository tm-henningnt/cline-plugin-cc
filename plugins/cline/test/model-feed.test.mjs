import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  candidateRows,
  handleModelFeed,
  parseWish,
} from "../scripts/lib/model-feed.mjs";

const NOW = "2026-07-09T12:00:00.000Z";

function validFeed(overrides = {}) {
  return {
    schema_version: "1.0.0",
    feed: {
      id: "feed-1",
      generated_at: "2026-07-09T11:55:00.000Z",
      expires_at: null,
      source_revision: "abc",
      default_stale_after_seconds: 3600,
      ...overrides.feed,
    },
    providers: [
      {
        id: "openrouter",
        object: "provider",
        name: "OpenRouter",
        homepage: "https://openrouter.ai",
        api_protocols: ["openai_chat_completions"],
        default_base_url: null,
        authentication: { type: "api_key", header: "Authorization", scheme: "Bearer", credential_hint: "OpenRouter key" },
        signup: { required: true, credit_card_required: false },
        source_claims: [],
      },
      {
        id: "freehost",
        object: "provider",
        name: "FreeHost",
        homepage: "https://free.example",
        api_protocols: ["openai_responses"],
        default_base_url: null,
        authentication: { type: "none", header: null, scheme: null, credential_hint: null },
        signup: { required: false, credit_card_required: false },
        source_claims: [],
      },
      ...(overrides.providers ?? []),
    ],
    models: [
      model({
        id: "freehost/deep-free",
        display_name: "Deep Free",
        provider: { id: "freehost", name: "FreeHost" },
        provider_model_id: "deep-free",
        endpoint: { protocol: "openai_responses", base_url: null, model: "deep-free" },
        capabilities: ["coding", "tool_use", "structured_output"],
        limits: { context_tokens: 262144, max_output_tokens: 8192 },
        pricing: {
          kind: "free",
          input_usd_per_1m_tokens: 0,
          output_usd_per_1m_tokens: 0,
          currency: "USD",
          metering: "tokens",
          free: {
            is_currently_free: true,
            basis: "zero_priced_model",
            requires_account: false,
            requires_api_key: false,
            requires_credit_card: false,
            quota: "daily",
            expires_at: null,
            last_verified_at: "2026-07-09T11:50:00.000Z",
            confidence: "high",
          },
        },
        availability: {
          status: "available",
          last_checked_at: "2026-07-09T11:52:00.000Z",
          last_success_at: "2026-07-09T11:52:00.000Z",
          stale_after_seconds: 3600,
        },
        quality: { coding_score: 80, reasoning_score: 70, speed_score: 60, recommendation_notes: [] },
        source_claims: [
          {
            id: "claim-1",
            source_type: "pricing_page",
            source_url: "https://free.example/pricing",
            collector: "test",
            observed_at: "2026-07-09T11:50:00.000Z",
            field_paths: ["pricing"],
            confidence: "high",
            raw_reference: null,
          },
        ],
        policy: { visibility: "listed", tags: [], recommended_for_agentic_workflows: true },
      }),
      model({
        id: "openrouter/kimi",
        display_name: "Kimi",
        provider: { id: "openrouter", name: "OpenRouter" },
        provider_model_id: "moonshotai/kimi",
        canonical_model: { id: "kimi-k2", confidence: "high" },
        endpoint: { protocol: "openai_chat_completions", base_url: null, model: "moonshotai/kimi" },
        capabilities: ["coding", "tool_use"],
        limits: { context_tokens: 128000, max_output_tokens: 8192 },
        pricing: {
          kind: "paid",
          input_usd_per_1m_tokens: 0.2,
          output_usd_per_1m_tokens: 0.8,
          currency: "USD",
          metering: "tokens",
          free: null,
        },
        source_claims: [
          {
            id: "claim-2",
            source_type: "catalog_page",
            source_url: "https://openrouter.ai/kimi",
            collector: "test",
            observed_at: "2026-07-09T11:50:00.000Z",
            field_paths: ["pricing"],
            confidence: "medium",
            raw_reference: null,
          },
        ],
      }),
      model({
        id: "openrouter/kimi-cheap",
        display_name: "Kimi Cheap",
        provider: { id: "openrouter", name: "OpenRouter" },
        provider_model_id: "moonshotai/kimi-cheap",
        canonical_model: { id: "kimi-k2", confidence: "medium" },
        endpoint: { protocol: "openai_chat_completions", base_url: null, model: "moonshotai/kimi-cheap" },
        capabilities: ["coding"],
        limits: { context_tokens: 64000, max_output_tokens: 4096 },
        pricing: {
          kind: "paid",
          input_usd_per_1m_tokens: 0.1,
          output_usd_per_1m_tokens: 0.2,
          currency: "USD",
          metering: "tokens",
          free: null,
        },
      }),
      ...(overrides.models ?? []),
    ],
    profiles: [],
    notices: [],
  };
}

function model(overrides) {
  return {
    object: "model_offering",
    canonical_model: null,
    description: null,
    capabilities: ["coding"],
    limits: { context_tokens: null, max_output_tokens: null },
    pricing: { kind: "unknown", input_usd_per_1m_tokens: null, output_usd_per_1m_tokens: null, currency: null, metering: null, free: null },
    availability: { status: "available", last_checked_at: null, last_success_at: null, stale_after_seconds: null },
    quality: { coding_score: null, reasoning_score: null, speed_score: null, recommendation_notes: [] },
    source_claims: [],
    policy: { visibility: "listed", tags: [], recommended_for_agentic_workflows: null },
    ...overrides,
  };
}

function memoryDeps({ feed = validFeed(), status = null, env = {}, projectDoc = null, failFeed = false, failSecret = false } = {}) {
  const calls = [];
  const writes = [];
  const tempSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const state = {
    config: null,
    secret: null,
    cache: null,
    projectDoc,
    projectPath: "/tmp/project/.cline-profiles.json",
  };
  return {
    state,
    deps: {
      env,
      paths: () => ({
        configPath: `/tmp/model-feed-${tempSuffix}.json`,
        secretPath: `/tmp/model-feed-${tempSuffix}.secrets.json`,
        cachePath: `/tmp/model-feed-${tempSuffix}.cache.json`,
      }),
      readText: () => "FILE_SECRET",
      readConfig: () => state.config ? { config: state.config } : { error: { code: "missing", message: "missing" } },
      writeConfig: (config) => {
        writes.push("config");
        state.config = config;
      },
      readSecret: () => state.secret ?? {},
      writeSecret: (_path, secret) => {
        if (failSecret) {
          throw new Error("secret write failed");
        }
        writes.push("secret");
        state.secret = secret;
      },
      readCache: () => state.cache ? { cache: state.cache } : { error: { code: "missing", message: "missing" } },
      writeCache: (_path, cache) => {
        writes.push("cache");
        state.cache = cache;
      },
      removeConfig: () => {
        writes.push("remove-config");
        state.config = null;
      },
      removeCache: () => {
        writes.push("remove-cache");
        state.cache = null;
      },
      readProjectProfiles: () => state.projectDoc
        ? { path: state.projectPath, dir: "/tmp/project", doc: state.projectDoc }
        : { path: null, dir: "/tmp/project", doc: null },
      writeProjectProfiles: (_path, doc) => {
        writes.push("project");
        state.projectDoc = doc;
      },
      fetchJson: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/v1/status")) {
          return {
            ok: true,
            status: 200,
            headers: {},
            body: status ?? {
              object: "feed_status",
              generated_at: "2026-07-09T11:55:00.000Z",
              stale: false,
              collector_health: { status: "ok", message: "ok", notices: [] },
            },
          };
        }
        if (failFeed) {
          return { ok: false, status: 503, statusText: "Unavailable", headers: {}, body: { error: "down" } };
        }
        if (options?.headers?.["If-None-Match"] === '"cached"') {
          return { ok: false, status: 304, headers: {}, body: null };
        }
        return {
          ok: true,
          status: 200,
          headers: { etag: '"fresh"', lastModified: "Thu, 09 Jul 2026 11:55:00 GMT" },
          body: feed,
        };
      },
    },
    calls,
    writes,
  };
}

test("model-feed status reports setup required without a default base URL", async () => {
  const { deps } = memoryDeps();

  const out = await handleModelFeed(["status"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /Setup: required/);
  assert.match(out.text, /Default feed base URL: none/);
});

test("model-feed help renders usage summary", async () => {
  const { deps } = memoryDeps();

  const out = await handleModelFeed(["help"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /\*\*Model Feed Help\*\*/);
  assert.match(out.text, /setup --base-url <url> --no-api-key/);
  assert.match(out.text, /tm-henningnt\/model-discovery-feed/);
});

test("model-feed unknown subcommands point to help", async () => {
  const { deps } = memoryDeps();

  const out = await handleModelFeed(["nonsense"], { nowIso: NOW }, deps);

  assert.equal(out.ok, false);
  assert.match(out.text, /Unknown model-feed subcommand: nonsense/);
  assert.match(out.text, /model-feed help/);
});

test("model-feed setup persists no-key config and cache without hardcoded default", async () => {
  const { deps, state } = memoryDeps();

  const out = await handleModelFeed(["setup", "--base-url", "https://feed.example", "--no-api-key"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(state.config.feedBaseUrl, "https://feed.example");
  assert.equal(state.config.endpoints.feed, "https://feed.example/v1/feed");
  assert.equal(state.config.endpoints.status, "https://feed.example/v1/status");
  assert.deepEqual(state.config.apiKey, { type: "none" });
  assert.equal(state.cache.feed.schema_version, "1.0.0");
  assert.equal(state.cache.etag, '"fresh"');
  assert.doesNotMatch(JSON.stringify(state.cache), /SECRET/);
});

test("model-feed setup supports standard feed-url derivation", async () => {
  const { deps, state } = memoryDeps();

  const out = await handleModelFeed(["setup", "--feed-url", "https://feed.example/v1/feed", "--no-api-key"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(state.config.feedBaseUrl, "https://feed.example");
  assert.equal(state.config.endpoints.schema, "https://feed.example/v1/schema");
  assert.equal(state.config.endpoints.status, "https://feed.example/v1/status");
  assert.equal(state.config.endpoints.feed, "https://feed.example/v1/feed");
});

test("model-feed setup persists explicit custom feed endpoints", async () => {
  const { deps, state } = memoryDeps();

  const out = await handleModelFeed([
    "setup",
    "--feed-url",
    "https://api.example/custom-feed",
    "--schema-url",
    "https://api.example/schema",
    "--status-url",
    "https://api.example/health",
    "--no-api-key",
  ], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(state.config.feedBaseUrl, "");
  assert.equal(state.config.endpoints.schema, "https://api.example/schema");
  assert.equal(state.config.endpoints.status, "https://api.example/health");
  assert.equal(state.config.endpoints.feed, "https://api.example/custom-feed");
});

test("model-feed setup stores env key reference but never the key", async () => {
  const { deps, state, calls } = memoryDeps({ env: { MODEL_FEED_API_KEY: "SECRET_TOKEN" } });

  const out = await handleModelFeed(["setup", "--base-url", "https://feed.example", "--api-key-env", "MODEL_FEED_API_KEY"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.deepEqual(state.config.apiKey, { type: "env", name: "MODEL_FEED_API_KEY" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer SECRET_TOKEN");
  assert.doesNotMatch(out.text, /SECRET_TOKEN/);
  assert.doesNotMatch(JSON.stringify(state.config), /SECRET_TOKEN/);
  assert.doesNotMatch(JSON.stringify(state.cache), /SECRET_TOKEN/);
});

test("model-feed setup supports explicit local secret file mode and writes the secret last", async () => {
  const { deps, state, calls, writes } = memoryDeps();

  const out = await handleModelFeed(["setup", "--base-url", "https://feed.example", "--api-key-stdin"], { nowIso: NOW, stdin: "LOCAL_SECRET\n" }, deps);

  assert.equal(out.ok, true);
  assert.deepEqual(state.config.apiKey, { type: "local-file" });
  assert.equal(state.secret.feedApiKey, "LOCAL_SECRET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer LOCAL_SECRET");
  assert.doesNotMatch(out.text, /LOCAL_SECRET/);
  assert.deepEqual(writes, ["config", "cache", "secret"]);
});

test("model-feed setup rolls back config and cache when local secret write fails", async () => {
  const { deps, state, writes } = memoryDeps({ failSecret: true });

  const out = await handleModelFeed(["setup", "--base-url", "https://feed.example", "--api-key-stdin"], { nowIso: NOW, stdin: "LOCAL_SECRET\n" }, deps);

  assert.equal(out.ok, false);
  assert.match(out.text, /secret write failed/);
  assert.equal(state.config, null);
  assert.equal(state.cache, null);
  assert.equal(state.secret, null);
  assert.deepEqual(writes, ["config", "cache", "remove-config", "remove-cache"]);
  assert.doesNotMatch(out.text, /LOCAL_SECRET/);
});

test("model-feed setup rejects unsupported schema", async () => {
  const { deps, state } = memoryDeps({ feed: { ...validFeed(), schema_version: "2.0.0" } });

  const out = await handleModelFeed(["setup", "--base-url", "https://feed.example", "--no-api-key"], { nowIso: NOW }, deps);

  assert.equal(out.ok, false);
  assert.match(out.text, /Unsupported Model Feed schema_version 2\.0\.0/);
  assert.equal(state.config, null);
});

test("model-feed refresh reuses cached feed on 304", async () => {
  const { deps, state, calls } = memoryDeps();
  state.config = {
    schemaVersion: 1,
    feedBaseUrl: "https://feed.example",
    endpoints: {
      schema: "https://feed.example/v1/schema",
      status: "https://feed.example/v1/status",
      feed: "https://feed.example/v1/feed",
    },
    apiKey: { type: "none" },
    cachePath: "/tmp/model-feed-cache.json",
  };
  state.cache = {
    schemaVersion: 1,
    feedBaseUrlHash: hashText("https://feed.example"),
    feedUrl: "https://feed.example/v1/feed",
    etag: '"cached"',
    fetchedAt: "2026-07-09T11:00:00.000Z",
    feed: validFeed(),
  };

  const out = await handleModelFeed(["free-coding", "--json"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(calls[0].options.headers["If-None-Match"], '"cached"');
  const json = JSON.parse(out.text);
  assert.deepEqual(json.warnings, ["Feed cache reused via ETag."]);
  assert.equal(json.candidates[0].id, "freehost/deep-free");
});

test("model-feed ignores cache when cache identity does not match config", async () => {
  const { deps, state, calls } = memoryDeps();
  state.config = configured();
  state.cache = {
    schemaVersion: 1,
    feedBaseUrlHash: "wrong",
    feedUrl: "https://other.example/v1/feed",
    etag: '"cached"',
    fetchedAt: "2026-07-09T11:00:00.000Z",
    feed: validFeed(),
  };

  const out = await handleModelFeed(["free-coding", "--json"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(calls[0].options.headers["If-None-Match"], undefined);
  const json = JSON.parse(out.text);
  assert.deepEqual(json.warnings, []);
  assert.equal(json.candidates[0].id, "freehost/deep-free");
});

test("profile add write fails closed instead of using stale cache after refresh failure", async () => {
  const { deps, state } = memoryDeps({ failFeed: true, projectDoc: { profiles: [] } });
  state.config = configured();
  state.cache = {
    schemaVersion: 1,
    feedBaseUrlHash: hashText("https://feed.example"),
    feedUrl: "https://feed.example/v1/feed",
    etag: '"cached"',
    fetchedAt: "2026-07-09T11:00:00.000Z",
    feed: validFeed(),
  };

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);

  assert.equal(out.ok, false);
  assert.match(out.text, /Feed request failed with HTTP 503/);
  assert.equal(state.projectDoc.profiles.length, 0);
});

test("candidate rows ignore unknown fields and expose profileability", () => {
  const feed = validFeed({
    feed: { future: true },
    models: [
      { ...model({ id: "x", display_name: "X", provider: { id: "", name: "" }, endpoint: { protocol: "unknown", model: "" } }), future: true },
      model({ id: "missing-policy", display_name: "Missing Policy", provider: { id: "freehost", name: "FreeHost" }, endpoint: { protocol: "openai_responses", model: "missing-policy" }, policy: undefined }),
      model({ id: "custom-base-url", display_name: "Custom Base URL", provider: { id: "freehost", name: "FreeHost" }, endpoint: { protocol: "openai_responses", base_url: "https://custom.example", model: "custom" } }),
    ],
  });

  const rows = candidateRows(feed, NOW);

  assert.equal(rows.find((row) => row.id === "freehost/deep-free").profile.profileable, true);
  assert.equal(rows.find((row) => row.id === "x").profile.profileable, false);
  assert.equal(rows.find((row) => row.id === "missing-policy").visibility, "unknown");
  assert.equal(rows.find((row) => row.id === "missing-policy").profile.profileable, false);
  assert.equal(rows.find((row) => row.id === "custom-base-url").profile.profileable, false);
  assert.match(rows.find((row) => row.id === "custom-base-url").profile.reason, /custom base URL/);
});

test("free-coding returns strict currently-free coding candidates with provenance", async () => {
  const { deps, state } = memoryDeps();
  state.config = configured();

  const out = await handleModelFeed(["free-coding", "--json"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  const json = JSON.parse(out.text);
  assert.equal(json.candidates.length, 1);
  assert.equal(json.candidates[0].id, "freehost/deep-free");
  assert.equal(json.candidates[0].pricing.kind, "free");
  assert.equal(json.candidates[0].sourceClaims[0].sourceType, "pricing_page");
});

test("free-coding excludes stale free claims unless freeish is requested", async () => {
  const stale = validFeed({
    models: [
      model({
        id: "freehost/stale",
        display_name: "Stale",
        provider: { id: "freehost", name: "FreeHost" },
        endpoint: { protocol: "openai_responses", model: "stale" },
        pricing: {
          kind: "free",
          input_usd_per_1m_tokens: 0,
          output_usd_per_1m_tokens: 0,
          free: {
            is_currently_free: true,
            last_verified_at: "2026-07-01T00:00:00.000Z",
            expires_at: null,
            requires_account: null,
            requires_api_key: null,
            requires_credit_card: null,
          },
        },
        availability: { status: "available", stale_after_seconds: 60 },
      }),
    ],
  });
  stale.models = stale.models.filter((item) => item.id === "freehost/stale");
  const { deps, state } = memoryDeps({ feed: stale });
  state.config = configured();

  const strict = await handleModelFeed(["free-coding", "--json"], { nowIso: NOW }, deps);
  const freeish = await handleModelFeed(["free-coding", "--freeish", "--json"], { nowIso: NOW }, deps);

  assert.equal(JSON.parse(strict.text).candidates.length, 0);
  assert.equal(JSON.parse(freeish.text).candidates.length, 1);
});

test("cheapest ranks canonical offerings by weighted cost", async () => {
  const { deps, state } = memoryDeps();
  state.config = configured();

  const out = await handleModelFeed(["cheapest", "--canonical-model", "kimi-k2", "--json"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  const json = JSON.parse(out.text);
  assert.equal(json.candidates[0].id, "openrouter/kimi-cheap");
  assert.equal(json.candidates[1].id, "openrouter/kimi");
});

test("suggest parses criteria, reports unparsed terms, and returns candidates", async () => {
  const { deps, state } = memoryDeps();
  state.config = configured();

  const out = await handleModelFeed(["suggest", "need free long context tool use no credit card unicorn"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /Criteria:/);
  assert.match(out.text, /Unparsed terms: unicorn/);
  assert.match(out.text, /freehost\/deep-free/);
});

test("suggest does not satisfy requested coding capability by inventing it", async () => {
  const noCoding = validFeed({
    models: [
      model({
        id: "freehost/chat-only",
        display_name: "Chat Only",
        provider: { id: "freehost", name: "FreeHost" },
        endpoint: { protocol: "openai_responses", model: "chat-only" },
        capabilities: ["chat"],
        pricing: {
          kind: "free",
          input_usd_per_1m_tokens: 0,
          output_usd_per_1m_tokens: 0,
          free: {
            is_currently_free: true,
            last_verified_at: "2026-07-09T11:50:00.000Z",
            expires_at: null,
          },
        },
        availability: { status: "available", stale_after_seconds: 3600 },
      }),
    ],
  });
  noCoding.models = noCoding.models.filter((item) => item.id === "freehost/chat-only");
  const { deps, state } = memoryDeps({ feed: noCoding });
  state.config = configured();

  const out = await handleModelFeed(["suggest", "free coding"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /No exact match/);
});

test("suggest uses cheap preference as a ranking signal", async () => {
  const { deps, state } = memoryDeps();
  state.config = configured();

  const out = await handleModelFeed(["suggest", "cheap coding", "--json"], { nowIso: NOW }, deps);

  const json = JSON.parse(out.text);
  assert.equal(json.candidates[0].id, "freehost/deep-free");
  assert.equal(json.criteria.filters.preferCheap, true);
});

test("parseWish is deterministic and does not hide unsupported terms", () => {
  const parsed = parseWish("need a free long context model with tool use and no api key sparkle");

  assert.equal(parsed.filters.strictFree, true);
  assert.equal(parsed.filters.minContextTokens, 128000);
  assert.deepEqual(parsed.filters.capabilities, ["tool_use"]);
  assert.equal(parsed.filters.requiresApiKey, false);
  assert.deepEqual(parsed.unparsedTerms, ["sparkle"]);
});

test("profile add dry-run prints entry and does not write", async () => {
  const { deps, state } = memoryDeps({ projectDoc: { note: "keep", profiles: [], ledger: true } });
  state.config = configured();

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /dry run/);
  assert.match(out.text, /"name": "free-coder"/);
  assert.equal(state.projectDoc.profiles.length, 0);
});

test("profile add dry-run may use stale cache after refresh failure", async () => {
  const { deps, state } = memoryDeps({ failFeed: true, projectDoc: { profiles: [] } });
  state.config = configured();
  state.cache = {
    schemaVersion: 1,
    feedBaseUrlHash: hashText("https://feed.example"),
    feedUrl: "https://feed.example/v1/feed",
    etag: '"cached"',
    fetchedAt: "2026-07-09T11:00:00.000Z",
    feed: validFeed(),
  };

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.match(out.text, /dry run/);
  assert.equal(state.projectDoc.profiles.length, 0);
});

test("profile add write preserves project fields and requires replace for conflicts", async () => {
  const { deps, state } = memoryDeps({ projectDoc: { note: "keep", profiles: [{ name: "old", provider: "cline" }], ledger: true } });
  state.config = configured();

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(state.projectDoc.note, "keep");
  assert.equal(state.projectDoc.ledger, true);
  assert.deepEqual(state.projectDoc.profiles.map((profile) => profile.name), ["old", "free-coder"]);
  assert.equal(state.projectDoc.profiles[1].provider, "freehost");
  assert.equal(state.projectDoc.profiles[1].model, "deep-free");

  const conflict = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);
  assert.equal(conflict.ok, false);
  assert.match(conflict.text, /already exists/);
});

test("profile add write fails closed on malformed project profile arrays", async () => {
  const { deps, state } = memoryDeps({ projectDoc: { profiles: "oops" } });
  state.config = configured();

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);

  assert.equal(out.ok, false);
  assert.match(out.text, /malformed/i);
  assert.match(out.text, /profiles/);
  assert.deepEqual(state.projectDoc, { profiles: "oops" });
});

test("profile add write preserves ledger-only project documents", async () => {
  const { deps, state } = memoryDeps({ projectDoc: { ledger: true } });
  state.config = configured();

  const out = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(state.projectDoc.ledger, true);
  assert.equal(state.projectDoc.profiles.length, 1);
  assert.equal(state.projectDoc.profiles[0].name, "free-coder");
  assert.equal(state.projectDoc.profiles[0].provider, "freehost");
  assert.equal(state.projectDoc.profiles[0].model, "deep-free");
});

test("profile add write requires explicit create flag when project file is missing", async () => {
  const { deps, state } = memoryDeps();
  state.config = configured();

  const blocked = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write"], { nowIso: NOW }, deps);
  const created = await handleModelFeed(["profile", "add", "--candidate", "freehost/deep-free", "--name", "free-coder", "--write", "--create-project-file"], { nowIso: NOW }, deps);

  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /--create-project-file/);
  assert.equal(created.ok, true);
  assert.equal(state.projectDoc.profiles[0].name, "free-coder");
});

test("model-feed status renders cache age and skips missing custom status endpoint", async () => {
  const { deps, state, calls } = memoryDeps();
  state.config = {
    schemaVersion: 1,
    feedBaseUrl: "",
    endpoints: {
      schema: "",
      status: "",
      feed: "https://api.example/custom-feed",
    },
    apiKey: { type: "none" },
    cachePath: "/tmp/model-feed-cache.json",
  };
  state.cache = {
    schemaVersion: 1,
    feedBaseUrlHash: hashText(""),
    feedUrl: "https://api.example/custom-feed",
    fetchedAt: "2026-07-09T11:00:00.000Z",
    feed: validFeed(),
  };

  const out = await handleModelFeed(["status"], { nowIso: NOW }, deps);

  assert.equal(out.ok, true);
  assert.equal(calls.length, 0);
  assert.match(out.text, /age 60m/);
  assert.match(out.text, /Status endpoint: not configured/);
});

function configured() {
  return {
    schemaVersion: 1,
    feedBaseUrl: "https://feed.example",
    endpoints: {
      schema: "https://feed.example/v1/schema",
      status: "https://feed.example/v1/status",
      feed: "https://feed.example/v1/feed",
    },
    apiKey: { type: "none" },
    cachePath: "/tmp/model-feed-cache.json",
  };
}

function hashText(text) {
  return createHash("sha256").update(text).digest("base64url");
}
