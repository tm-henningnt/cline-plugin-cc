import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CONFIG_VERSION = 1;
const FEED_SCHEMA_VERSION = "1.0.0";
const DEFAULT_DIR = join(homedir(), ".cline-plugin-cc");
const DEFAULT_CONFIG_PATH = join(DEFAULT_DIR, "model-feed.json");
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "i",
  "need",
  "model",
  "models",
  "the",
  "to",
  "with",
  "we",
  "have",
  "but",
  "want",
]);

export function modelFeedPaths(env = process.env) {
  const configPath = env.CLINE_MODEL_FEED_CONFIG
    ? resolve(String(env.CLINE_MODEL_FEED_CONFIG))
    : DEFAULT_CONFIG_PATH;
  const dir = dirname(configPath);
  return {
    configPath,
    secretPath: join(dir, "model-feed.secrets.json"),
    cachePath: join(dir, "model-feed-cache.json"),
  };
}

export function parseModelFeedArgs(tokens = []) {
  const args = Array.isArray(tokens) ? tokens.slice() : [];
  const opts = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--json") {
      opts.json = true;
    } else if (token === "--no-api-key") {
      opts.noApiKey = true;
    } else if (token === "--api-key-env") {
      opts.apiKeyEnv = args[++i];
    } else if (token === "--api-key-stdin") {
      opts.apiKeyStdin = true;
    } else if (token === "--api-key-file") {
      opts.apiKeyFile = args[++i];
    } else if (token === "--base-url") {
      opts.baseUrl = args[++i];
    } else if (token === "--feed-url") {
      opts.feedUrl = args[++i];
    } else if (token === "--status-url") {
      opts.statusUrl = args[++i];
    } else if (token === "--schema-url") {
      opts.schemaUrl = args[++i];
    } else if (token === "--cwd") {
      opts.cwd = args[++i];
    } else if (token === "--limit") {
      opts.limit = Number(args[++i]);
    } else if (token === "--openai-compatible") {
      opts.openaiCompatible = true;
    } else if (token === "--requires-credit-card") {
      opts.requiresCreditCard = parseBooleanArg(args[++i]);
    } else if (token === "--requires-api-key") {
      opts.requiresApiKey = parseBooleanArg(args[++i]);
    } else if (token === "--min-context-tokens") {
      opts.minContextTokens = Number(args[++i]);
    } else if (token === "--capability") {
      opts.capabilities ??= [];
      opts.capabilities.push(args[++i]);
    } else if (token === "--profileable") {
      opts.profileable = true;
    } else if (token === "--freeish") {
      opts.freeish = true;
    } else if (token === "--q") {
      opts.q = args[++i];
    } else if (token === "--canonical-model") {
      opts.canonicalModel = args[++i];
    } else if (token === "--input-tokens") {
      opts.inputTokens = Number(args[++i]);
    } else if (token === "--output-tokens") {
      opts.outputTokens = Number(args[++i]);
    } else if (token === "--include-unknown-pricing") {
      opts.includeUnknownPricing = true;
    } else if (token === "--candidate") {
      opts.candidate = args[++i];
    } else if (token === "--name") {
      opts.name = args[++i];
    } else if (token === "--provider") {
      opts.provider = args[++i];
    } else if (token === "--model") {
      opts.model = args[++i];
    } else if (token === "--write") {
      opts.write = true;
    } else if (token === "--replace") {
      opts.replace = true;
    } else if (token === "--create-project-file") {
      opts.createProjectFile = true;
    } else {
      opts._.push(token);
    }
  }
  return opts;
}

export async function handleModelFeed(tokens = [], opts = {}, deps = defaultDeps()) {
  deps = { ...defaultDeps(), ...deps };
  const [subcommand, maybeAction, ...rest] = tokens;
  if (!subcommand || subcommand === "status") {
    const parsed = parseModelFeedArgs(tokens.slice(1));
    const nowIso = opts.nowIso ?? new Date().toISOString();
    try {
      return await modelFeedStatus(parsed, { nowIso }, deps);
    } catch (error) {
      return { ok: false, text: redactSecrets(`Model Feed command failed: ${error.message}`) };
    }
  }
  if (subcommand === "help" || subcommand === "--help") {
    return renderModelFeedHelp();
  }
  const parsed = parseModelFeedArgs(
    subcommand === "profile" && maybeAction === "add" ? rest : tokens.slice(1),
  );
  const nowIso = opts.nowIso ?? new Date().toISOString();
  try {
    if (subcommand === "setup") {
      return await modelFeedSetup(parsed, { nowIso, stdin: opts.stdin ?? "" }, deps);
    }
    if (subcommand === "free-coding") {
      return await modelFeedFreeCoding(parsed, { nowIso }, deps);
    }
    if (subcommand === "cheapest") {
      return await modelFeedCheapest(parsed, { nowIso }, deps);
    }
    if (subcommand === "suggest") {
      return await modelFeedSuggest({ ...parsed, wish: parsed._.join(" ") }, { nowIso }, deps);
    }
    if (subcommand === "profile" && maybeAction === "add") {
      return await modelFeedProfileAdd(parsed, { nowIso }, deps);
    }
    return { ok: false, text: `Unknown model-feed subcommand: ${subcommand}. Run /cline:model-feed help for usage.` };
  } catch (error) {
    return { ok: false, text: redactSecrets(`Model Feed command failed: ${error.message}`) };
  }
}

export async function modelFeedStatus(args = {}, opts = {}, deps = defaultDeps()) {
  const configRead = deps.readConfig();
  if (configRead.error?.code === "missing") {
    return renderStatus(
      {
        configured: false,
        message: "Model Feed setup is required. No default feed base URL is used.",
      },
      args,
    );
  }
  if (configRead.error) {
    return { ok: false, text: `Model Feed config is unreadable: ${configRead.error.message}` };
  }
  const config = normalizeConfig(configRead.config);
  const cacheRead = validCacheForConfig(deps.readCache(config.cachePath), config);
  let status = null;
  let warning = "";
  if (config.endpoints.status) {
    try {
      const token = readFeedToken(config, deps);
      const response = await deps.fetchJson(config.endpoints.status, {
        headers: authHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Status request failed with HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`);
      }
      status = response.body;
    } catch (error) {
      warning = `Status endpoint unavailable: ${redactSecrets(error.message)}`;
    }
  }
  return renderStatus(
    {
      configured: true,
      config,
      cache: cacheRead.cache ?? null,
      status,
      warning,
      statusConfigured: Boolean(config.endpoints.status),
      nowIso: opts.nowIso,
    },
    args,
  );
}

export async function modelFeedSetup(args = {}, opts = {}, deps = defaultDeps()) {
  const endpoints = deriveEndpoints(args);
  if (!endpoints.feedBaseUrl && !args.feedUrl) {
    return { ok: false, text: "Usage: /cline:model-feed setup --base-url <url> [--no-api-key|--api-key-env <name>|--api-key-stdin|--api-key-file <path>]" };
  }
  const apiKey = readSetupApiKey(args, opts, deps);
  if (!apiKey.ok) return { ok: false, text: apiKey.text };
  const paths = deps.paths();
  const configSnapshot = snapshotWritableFile(paths.configPath, deps);
  const cacheSnapshot = snapshotWritableFile(paths.cachePath, deps);
  const config = {
    schemaVersion: CONFIG_VERSION,
    feedBaseUrl: endpoints.feedBaseUrl,
    endpoints: endpoints.endpoints,
    apiKey: apiKey.config,
    cachePath: paths.cachePath,
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
  };
  const token = apiKey.secret ?? readFeedToken(config, deps);
  const fetched = await fetchFeed(config, deps, { token, cached: null });
  assertSupportedFeed(fetched.feed);
  try {
    deps.writeConfig(config);
    deps.writeCache(config.cachePath, {
      schemaVersion: CONFIG_VERSION,
      feedBaseUrlHash: hashText(config.feedBaseUrl ?? ""),
      feedUrl: config.endpoints.feed,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      fetchedAt: opts.nowIso,
      feed: fetched.feed,
    });
    if (apiKey.secret) {
      deps.writeSecret(paths.secretPath, {
        schemaVersion: CONFIG_VERSION,
        feedApiKey: apiKey.secret,
      });
    }
  } catch (error) {
    restoreWritableFile(paths.configPath, configSnapshot, deps.removeConfig);
    restoreWritableFile(config.cachePath, cacheSnapshot, deps.removeCache);
    throw error;
  }
  return {
    ok: true,
    text: [
      "**Model Feed Setup**",
      "",
      `- [x] Feed base URL: ${config.feedBaseUrl || "(custom feed endpoint)"}.`,
      `- [x] Feed schema: ${fetched.feed.schema_version}.`,
      `- [x] API key: ${describeApiKey(config.apiKey)}.`,
      `- [x] Cache: ${config.cachePath}.`,
      `- [x] Models cached: ${Array.isArray(fetched.feed.models) ? fetched.feed.models.length : 0}.`,
    ].join("\n"),
  };
}

export async function modelFeedFreeCoding(args = {}, opts = {}, deps = defaultDeps()) {
  const { feed, cache, warnings } = await loadConfiguredFeed({ ...args, allowStaleCache: true }, opts, deps);
  const candidates = candidateRows(feed, opts.nowIso)
    .filter((row) => matchesFreeCoding(row, args, opts.nowIso))
    .sort(compareFreeCodingCandidates)
    .slice(0, normalizedLimit(args.limit));
  return renderCandidates("Model Feed Free Coding Candidates", candidates, args, {
    feed,
    cache,
    warnings,
  });
}

export async function modelFeedCheapest(args = {}, opts = {}, deps = defaultDeps()) {
  const { feed, cache, warnings } = await loadConfiguredFeed({ ...args, allowStaleCache: true }, opts, deps);
  const query = normalize(args.q);
  const canonical = normalize(args.canonicalModel);
  let candidates = candidateRows(feed, opts.nowIso).filter((row) => row.visibility === "listed");
  if (canonical) {
    candidates = candidates.filter((row) => normalize(row.canonicalModelId) === canonical);
  } else if (query) {
    candidates = candidates.filter((row) =>
      [row.id, row.displayName, row.provider.id, row.provider.name, row.providerModelId]
        .some((value) => normalize(value).includes(query)),
    );
  }
  candidates = candidates
    .filter((row) => args.includeUnknownPricing || row.cost.known)
    .sort((a, b) => compareCost(a, b, args));
  return renderCandidates("Model Feed Cheapest Candidates", candidates.slice(0, normalizedLimit(args.limit)), args, {
    feed,
    cache,
    warnings,
    note: costFormula(args),
  });
}

export async function modelFeedSuggest(args = {}, opts = {}, deps = defaultDeps()) {
  const criteria = parseWish(args.wish ?? "");
  const merged = {
    ...args,
    ...criteria.filters,
    capabilities: [...(args.capabilities ?? []), ...(criteria.filters.capabilities ?? [])],
    minContextTokens: criteria.filters.minContextTokens ?? args.minContextTokens,
    freeish: criteria.filters.freeish ?? args.freeish,
  };
  const { feed, cache, warnings } = await loadConfiguredFeed({ ...args, allowStaleCache: true }, opts, deps);
  let all = candidateRows(feed, opts.nowIso).filter((row) => row.visibility === "listed");
  const candidates = all
    .filter((row) => matchesSuggestion(row, merged, opts.nowIso))
    .sort((a, b) => compareSuggestionCandidates(a, b, merged, opts.nowIso))
    .slice(0, normalizedLimit(args.limit));
  const nearest = candidates.length
    ? []
    : all.sort((a, b) => suggestionScore(b, merged, opts.nowIso) - suggestionScore(a, merged, opts.nowIso)).slice(0, 5);
  return renderCandidates("Model Feed Suggestions", candidates.length ? candidates : nearest, args, {
    feed,
    cache,
    warnings,
    criteria,
    gap: candidates.length === 0,
  });
}

export async function modelFeedProfileAdd(args = {}, opts = {}, deps = defaultDeps()) {
  if (!args.candidate || !args.name) {
    return { ok: false, text: "Usage: /cline:model-feed profile add --candidate <feed-model-id> --name <profile-name> [--write]" };
  }
  const { feed } = await loadConfiguredFeed(args.write ? args : { ...args, allowStaleCache: true }, opts, deps);
  const row = candidateRows(feed, opts.nowIso).find((candidate) => candidate.id === args.candidate);
  if (!row) return { ok: false, text: `Candidate not found: ${args.candidate}` };
  const profile = buildProfileEntry(row, args);
  if (!profile.ok) return { ok: false, text: profile.text };
  const project = deps.readProjectProfiles(args.cwd ?? process.cwd());
  if (project.error) {
    return { ok: false, text: `Cannot update project profiles: ${project.path} is unreadable (${project.error}).` };
  }
  if (!project.path && args.write && !args.createProjectFile) {
    return { ok: false, text: "No .cline-profiles.json found. Re-run with --create-project-file to create one." };
  }
  const writableProject = validateProjectProfilesForWrite(project, args);
  if (!writableProject.ok) return { ok: false, text: writableProject.text };
  const doc = writableProject.doc;
  const profiles = doc.profiles.slice();
  const existingIndex = profiles.findIndex((item) => item?.name === args.name);
  if (existingIndex !== -1 && !args.replace) {
    return { ok: false, text: `Profile "${args.name}" already exists. Re-run with --replace to update it.` };
  }
  const nextDoc = { ...doc, profiles };
  if (existingIndex === -1) profiles.push(profile.entry);
  else profiles[existingIndex] = profile.entry;
  if (!args.write) {
    return {
      ok: true,
      text: [
        "**Model Feed Profile Add (dry run)**",
        "",
        "No files changed. Proposed profile entry:",
        "",
        "```json",
        JSON.stringify(profile.entry, null, 2),
        "```",
      ].join("\n"),
    };
  }
  const writePath = project.path ?? join(resolve(args.cwd ?? process.cwd()), ".cline-profiles.json");
  deps.writeProjectProfiles(writePath, nextDoc);
  return {
    ok: true,
    text: [
      "**Model Feed Profile Add**",
      "",
      `- [x] Wrote profile ${code(args.name)} to ${writePath}.`,
      `- Verify with: /cline:profiles --cwd ${resolve(args.cwd ?? process.cwd())}`,
    ].join("\n"),
  };
}

function validateProjectProfilesForWrite(project, args) {
  if (!project.path) {
    if (args.write && !args.createProjectFile) {
      return { ok: false, text: "No .cline-profiles.json found. Re-run with --create-project-file to create one." };
    }
    return { ok: true, doc: { profiles: [] } };
  }
  if (!project.doc || typeof project.doc !== "object" || Array.isArray(project.doc)) {
    return { ok: false, text: `Cannot update project profiles: ${project.path} is malformed (expected a JSON object).` };
  }
  if (project.doc.profiles !== undefined && !Array.isArray(project.doc.profiles)) {
    return { ok: false, text: `Cannot update project profiles: ${project.path} has malformed profiles (expected an array).` };
  }
  return {
    ok: true,
    doc: {
      ...project.doc,
      profiles: Array.isArray(project.doc.profiles) ? project.doc.profiles.slice() : [],
    },
  };
}

export function candidateRows(feed, nowIso = new Date().toISOString()) {
  const providers = new Map((Array.isArray(feed?.providers) ? feed.providers : []).map((provider) => [provider.id, provider]));
  return (Array.isArray(feed?.models) ? feed.models : []).map((model) => {
    const provider = providers.get(model?.provider?.id) ?? {};
    const row = {
      id: String(model?.id ?? ""),
      displayName: String(model?.display_name ?? model?.id ?? ""),
      provider: {
        id: String(model?.provider?.id ?? ""),
        name: String(model?.provider?.name ?? provider?.name ?? ""),
      },
      providerModelId: String(model?.provider_model_id ?? ""),
      canonicalModelId: String(model?.canonical_model?.id ?? ""),
      endpoint: {
        protocol: String(model?.endpoint?.protocol ?? "unknown"),
        baseUrl: model?.endpoint?.base_url ?? null,
        model: String(model?.endpoint?.model ?? ""),
      },
      capabilities: Array.isArray(model?.capabilities) ? model.capabilities.map(String) : [],
      contextTokens: numberOrNull(model?.limits?.context_tokens),
      pricing: model?.pricing ?? {},
      availability: String(model?.availability?.status ?? "unknown"),
      availabilityDetail: model?.availability ?? {},
      quality: model?.quality ?? {},
      sourceClaims: Array.isArray(model?.source_claims) ? model.source_claims : [],
      visibility: String(model?.policy?.visibility ?? "unknown"),
      recommendedForAgenticWorkflows: model?.policy?.recommended_for_agentic_workflows === true,
      freeFresh: isStrictFreshFree(model, feed, nowIso),
      providerAuth: provider?.authentication ?? {},
      providerSignup: provider?.signup ?? {},
    };
    row.profile = profileForRow(row);
    row.cost = costForRow(row);
    row.pricingExplanation = pricingExplanation(row);
    return row;
  }).filter((row) => row.id);
}

export function parseWish(wish) {
  const text = normalize(wish);
  const filters = {};
  const parsed = [];
  const mark = (phrase) => {
    if (text.includes(phrase)) parsed.push(...phrase.split(/\s+/));
  };
  if (text.includes("free tier")) {
    filters.freeish = true;
    mark("free tier");
  } else if (text.includes("free")) {
    filters.strictFree = true;
    mark("free");
  }
  if (text.includes("trial")) {
    filters.freeish = true;
    mark("trial");
  }
  if (text.includes("local")) {
    filters.freeish = true;
    mark("local");
  }
  if (text.includes("cheap")) {
    filters.preferCheap = true;
    mark("cheap");
  }
  const capabilities = [];
  const capabilityTerms = [
    ["coding", "coding"],
    ["agentic", "tool_use"],
    ["tool use", "tool_use"],
    ["structured output", "structured_output"],
    ["json", "json_mode"],
    ["vision", "vision"],
    ["files", "files"],
  ];
  for (const [phrase, capability] of capabilityTerms) {
    if (text.includes(phrase)) {
      capabilities.push(capability);
      mark(phrase);
    }
  }
  if (text.includes("reasoning")) {
    filters.preferReasoning = true;
    mark("reasoning");
  }
  if (text.includes("review")) {
    filters.preferReasoning = true;
    mark("review");
  }
  if (text.includes("fast")) {
    filters.preferFast = true;
    mark("fast");
  }
  if (text.includes("no credit card")) {
    filters.requiresCreditCard = false;
    mark("no credit card");
  }
  if (text.includes("no api key")) {
    filters.requiresApiKey = false;
    mark("no api key");
  }
  const tokenMatch = text.match(/(\d[\d,]*)\s*k?\s*(?:token|context)/);
  if (tokenMatch) {
    const raw = Number(tokenMatch[1].replace(/,/g, ""));
    filters.minContextTokens = text.includes(`${tokenMatch[1]}k`) ? raw * 1000 : raw;
    parsed.push(tokenMatch[1], "token", "tokens", "context");
  } else if (text.includes("long context") || text.includes("large context")) {
    filters.minContextTokens = 128000;
    mark(text.includes("long context") ? "long context" : "large context");
  }
  if (capabilities.length) filters.capabilities = [...new Set(capabilities)];
  const parsedSet = new Set(parsed);
  const unparsedTerms = text
    .split(/[^a-z0-9._-]+/)
    .filter((word) => word && !STOPWORDS.has(word) && !parsedSet.has(word));
  return { filters, unparsedTerms: [...new Set(unparsedTerms)] };
}

function matchesFreeCoding(row, args, nowIso) {
  if (row.visibility !== "listed") return false;
  if (!row.capabilities.includes("coding")) return false;
  if (args.openaiCompatible && !isOpenAiCompatible(row.endpoint.protocol)) return false;
  if (args.profileable && !row.profile.profileable) return false;
  if (typeof args.minContextTokens === "number" && (row.contextTokens ?? 0) < args.minContextTokens) return false;
  for (const capability of args.capabilities ?? []) {
    if (!row.capabilities.includes(capability)) return false;
  }
  if (args.requiresCreditCard !== undefined && requirementValue(row, "credit_card") !== args.requiresCreditCard) return false;
  if (args.requiresApiKey !== undefined && requirementValue(row, "api_key") !== args.requiresApiKey) return false;
  if (!args.freeish) {
    return row.freeFresh && row.availability === "available";
  }
  return ["free", "free_tier", "trial", "subscription_included", "local"].includes(String(row.pricing.kind));
}

function matchesSuggestion(row, args, nowIso) {
  if (row.visibility !== "listed") return false;
  if (args.strictFree && !row.freeFresh) return false;
  if (args.freeish && !["free", "free_tier", "trial", "subscription_included", "local"].includes(String(row.pricing.kind))) {
    return false;
  }
  if (args.openaiCompatible && !isOpenAiCompatible(row.endpoint.protocol)) return false;
  if (args.profileable && !row.profile.profileable) return false;
  if (typeof args.minContextTokens === "number" && (row.contextTokens ?? 0) < args.minContextTokens) return false;
  for (const capability of args.capabilities ?? []) {
    if (!row.capabilities.includes(capability)) return false;
  }
  if (args.requiresCreditCard !== undefined && requirementValue(row, "credit_card") !== args.requiresCreditCard) return false;
  if (args.requiresApiKey !== undefined && requirementValue(row, "api_key") !== args.requiresApiKey) return false;
  return true;
}

function compareFreeCodingCandidates(a, b) {
  return (
    statusRank(a.availability) - statusRank(b.availability) ||
    Number(b.freeFresh) - Number(a.freeFresh) ||
    pricingKindRank(a.pricing.kind) - pricingKindRank(b.pricing.kind) ||
    Number(b.capabilities.includes("coding")) - Number(a.capabilities.includes("coding")) ||
    Number(b.capabilities.includes("tool_use")) - Number(a.capabilities.includes("tool_use")) ||
    Number(b.capabilities.includes("structured_output")) - Number(a.capabilities.includes("structured_output")) ||
    (b.contextTokens ?? 0) - (a.contextTokens ?? 0) ||
    Number(b.recommendedForAgenticWorkflows) - Number(a.recommendedForAgenticWorkflows) ||
    a.id.localeCompare(b.id)
  );
}

function compareCost(a, b, args) {
  const aCost = estimatedCost(a, args);
  const bCost = estimatedCost(b, args);
  return (
    Number(!a.cost.known) - Number(!b.cost.known) ||
    aCost - bCost ||
    compareFreeCodingCandidates(a, b)
  );
}

function compareSuggestionCandidates(a, b, args, nowIso) {
  return suggestionScore(b, args, nowIso) - suggestionScore(a, args, nowIso) || compareFreeCodingCandidates(a, b);
}

function estimatedCost(row, args) {
  if (!row.cost.known) return Number.POSITIVE_INFINITY;
  if (Number.isFinite(args.inputTokens) || Number.isFinite(args.outputTokens)) {
    return ((args.inputTokens || 0) / 1_000_000) * row.cost.input + ((args.outputTokens || 0) / 1_000_000) * row.cost.output;
  }
  return row.cost.input + 3 * row.cost.output;
}

function suggestionScore(row, args, nowIso) {
  let score = 0;
  for (const capability of args.capabilities ?? []) if (row.capabilities.includes(capability)) score += 4;
  if (!args.minContextTokens || (row.contextTokens ?? 0) >= args.minContextTokens) score += 2;
  if (!args.strictFree || row.freeFresh) score += 3;
  if (args.requiresCreditCard === undefined || requirementValue(row, "credit_card") === args.requiresCreditCard) score += 1;
  if (args.requiresApiKey === undefined || requirementValue(row, "api_key") === args.requiresApiKey) score += 1;
  if (args.preferCheap && row.cost.known) score += Math.max(0, 3 - estimatedCost(row, {}));
  if (args.preferFast && typeof row.quality.speed_score === "number") score += row.quality.speed_score / 100;
  if (args.preferReasoning && typeof row.quality.reasoning_score === "number") score += row.quality.reasoning_score / 100;
  if (row.profile.profileable) score += 1;
  return score;
}

async function loadConfiguredFeed(args, opts, deps) {
  const configRead = deps.readConfig();
  if (configRead.error) {
    throw new Error("Model Feed setup is required. Run /cline:model-feed setup --base-url <url> first.");
  }
  const config = normalizeConfig(configRead.config);
  const cacheRead = validCacheForConfig(deps.readCache(config.cachePath), config);
  const token = readFeedToken(config, deps);
  try {
    const fetched = await fetchFeed(config, deps, { token, cached: cacheRead.cache ?? null });
    assertSupportedFeed(fetched.feed);
    if (!fetched.reused) {
      deps.writeCache(config.cachePath, {
        schemaVersion: CONFIG_VERSION,
        feedBaseUrlHash: hashText(config.feedBaseUrl ?? ""),
        feedUrl: config.endpoints.feed,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchedAt: opts.nowIso,
        feed: fetched.feed,
      });
    }
    return { feed: fetched.feed, cache: cacheRead.cache ?? null, warnings: fetched.reused ? ["Feed cache reused via ETag."] : [] };
  } catch (error) {
    if (args.allowStaleCache && cacheRead.cache?.feed) {
      assertSupportedFeed(cacheRead.cache.feed);
      return {
        feed: cacheRead.cache.feed,
        cache: cacheRead.cache,
        warnings: [`Using stale cached feed after refresh failed: ${redactSecrets(error.message)}`],
      };
    }
    throw error;
  }
}

function validCacheForConfig(cacheRead, config) {
  const cache = cacheRead.cache;
  if (!cache) return cacheRead;
  if (cache.feedBaseUrlHash !== hashText(config.feedBaseUrl ?? "")) {
    return { error: { code: "cache-mismatch", message: "cache base URL does not match config" } };
  }
  if (cache.feedUrl !== config.endpoints.feed) {
    return { error: { code: "cache-mismatch", message: "cache feed URL does not match config" } };
  }
  return cacheRead;
}

async function fetchFeed(config, deps, { token, cached }) {
  const headers = {
    Accept: "application/json",
    ...authHeaders(token),
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  const response = await deps.fetchJson(config.endpoints.feed, { headers });
  if (response.status === 304) {
    if (!cached?.feed) throw new Error("Feed returned 304 but no cached feed is available.");
    return {
      reused: true,
      feed: cached.feed,
      etag: cached.etag ?? null,
      lastModified: cached.lastModified ?? null,
    };
  }
  if (!response.ok) {
    throw new Error(`Feed request failed with HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`);
  }
  return {
    reused: false,
    feed: response.body,
    etag: response.headers?.etag ?? null,
    lastModified: response.headers?.lastModified ?? null,
  };
}

function renderStatus(state, args) {
  if (args.json) return { ok: true, text: JSON.stringify(state, null, 2) };
  if (!state.configured) {
    return {
      ok: true,
      text: ["**Model Feed Status**", "", "- [ ] Setup: required.", "- [x] Default feed base URL: none."].join("\n"),
    };
  }
  const lines = [
    "**Model Feed Status**",
    "",
    `- [x] Config: ${state.config.feedBaseUrl || state.config.endpoints.feed}.`,
    `- [x] API key: ${describeApiKey(state.config.apiKey)}.`,
  ];
  if (state.cache) {
    const fetchedAt = state.cache.fetchedAt ?? "(unknown)";
    lines.push(`- [x] Cache: fetched at ${fetchedAt} (age ${formatCacheAge(state.cache.fetchedAt, state.nowIso)}).`);
  } else {
    lines.push("- [ ] Cache: empty.");
  }
  if (state.statusConfigured === false) {
    lines.push("- [ ] Status endpoint: not configured for this custom feed URL.");
  }
  if (state.status) {
    lines.push(`- [x] Feed: generated at ${state.status.generated_at ?? "(unknown)"}.`);
    lines.push(`- [${state.status.stale ? " " : "x"}] Freshness: ${state.status.stale ? "stale" : "fresh"}.`);
    const health = state.status.collector_health?.status ?? "unknown";
    lines.push(`- [${health === "ok" ? "x" : " "}] Collector health: ${health}.`);
  }
  if (state.warning) lines.push(`- [ ] Warning: ${state.warning}.`);
  return { ok: true, text: lines.join("\n") };
}

function renderCandidates(title, candidates, args, context) {
  const payload = {
    title,
    criteria: context.criteria ?? null,
    gap: Boolean(context.gap),
    warnings: context.warnings ?? [],
    candidates: candidates.map(toJsonCandidate),
  };
  if (args.json) return { ok: true, text: JSON.stringify(payload, null, 2) };
  const lines = [`**${title}**`, ""];
  const generatedAt = context.feed?.feed?.generated_at ?? context.feed?.feed?.id ?? null;
  if (generatedAt) lines.push(`Feed: ${generatedAt}`, "");
  for (const warning of context.warnings ?? []) lines.push(`Warning: ${warning}`);
  if (context.criteria) {
    lines.push(`Criteria: ${JSON.stringify(context.criteria.filters)}`);
    if (context.criteria.unparsedTerms.length) lines.push(`Unparsed terms: ${context.criteria.unparsedTerms.join(", ")}`);
    if (context.gap) lines.push("No exact match. Showing nearest candidates.");
    lines.push("");
  }
  if (context.note) lines.push(`${context.note}`, "");
  if (candidates.length === 0) {
    lines.push("No candidates found.");
    return { ok: true, text: lines.join("\n") };
  }
  for (const row of candidates) {
    lines.push(`- ${code(row.id)}: ${row.displayName} (${row.provider.name || row.provider.id})`);
    lines.push(`  Profile: ${row.profile.profileable ? `${row.profile.provider} / ${row.profile.model}` : `not profileable - ${row.profile.reason}`}`);
    lines.push(`  Pricing: ${row.pricingExplanation}`);
    lines.push(`  Availability: ${row.availability}; context: ${row.contextTokens ?? "unknown"}; capabilities: ${row.capabilities.join(", ") || "unknown"}`);
    const reqs = requirementSummary(row);
    if (reqs) lines.push(`  Requirements: ${reqs}`);
    const source = row.sourceClaims[0];
    if (source) {
      lines.push(
        `  Source: ${source.source_type ?? "unknown"}${source.source_url ? ` ${source.source_url}` : ""} (${source.confidence ?? "unknown"}, ${source.observed_at ?? "unknown"})`,
      );
    }
  }
  return { ok: true, text: lines.join("\n") };
}

function toJsonCandidate(row) {
  return {
    id: row.id,
    displayName: row.displayName,
    provider: row.provider,
    profile: row.profile,
    capabilities: row.capabilities,
    contextTokens: row.contextTokens,
    pricing: {
      kind: row.pricing.kind ?? "unknown",
      explanation: row.pricingExplanation,
      inputUsdPer1mTokens: numberOrNull(row.pricing.input_usd_per_1m_tokens),
      outputUsdPer1mTokens: numberOrNull(row.pricing.output_usd_per_1m_tokens),
    },
    availability: row.availability,
    sourceClaims: row.sourceClaims.map((claim) => ({
      sourceType: claim.source_type ?? "unknown",
      sourceUrl: claim.source_url ?? null,
      observedAt: claim.observed_at ?? null,
      confidence: claim.confidence ?? "unknown",
    })),
  };
}

function deriveEndpoints(args) {
  if (args.feedUrl) {
    const feed = normalizeUrl(args.feedUrl);
    const base = feed.replace(/\/v1\/feed\/?$/, "");
    return {
      feedBaseUrl: base === feed ? "" : base,
      endpoints: {
        schema: base === feed ? normalizeUrl(args.schemaUrl ?? "") : `${base}/v1/schema`,
        status: base === feed ? normalizeUrl(args.statusUrl ?? "") : `${base}/v1/status`,
        feed,
      },
    };
  }
  const base = normalizeUrl(args.baseUrl ?? "");
  return {
    feedBaseUrl: base,
    endpoints: {
      schema: `${base}/v1/schema`,
      status: `${base}/v1/status`,
      feed: `${base}/v1/feed`,
    },
  };
}

function readSetupApiKey(args, opts, deps) {
  const modes = [args.noApiKey, args.apiKeyEnv, args.apiKeyStdin, args.apiKeyFile].filter(Boolean);
  if (modes.length !== 1) {
    return { ok: false, text: "Choose exactly one API key mode: --no-api-key, --api-key-env <name>, --api-key-stdin, or --api-key-file <path>." };
  }
  if (args.noApiKey) return { ok: true, config: { type: "none" } };
  if (args.apiKeyEnv) return { ok: true, config: { type: "env", name: String(args.apiKeyEnv) } };
  if (args.apiKeyStdin) {
    const key = String(opts.stdin ?? "").trim();
    if (!key) return { ok: false, text: "--api-key-stdin requires a key on stdin; use --api-key-env for slash-command setup." };
    return { ok: true, config: { type: "local-file" }, secret: key };
  }
  if (args.apiKeyFile) {
    const key = deps.readText(args.apiKeyFile).trim();
    if (!key) return { ok: false, text: "--api-key-file was empty." };
    return { ok: true, config: { type: "local-file" }, secret: key };
  }
  return { ok: false, text: "No API key mode selected." };
}

function readFeedToken(config, deps) {
  const apiKey = config.apiKey ?? { type: "none" };
  if (apiKey.type === "none") return "";
  if (apiKey.type === "env") return String(deps.env?.[apiKey.name] ?? "");
  if (apiKey.type === "local-file") {
    const secret = deps.readSecret(deps.paths().secretPath);
    return String(secret?.feedApiKey ?? "");
  }
  return "";
}

function buildProfileEntry(row, args) {
  const provider = args.provider ?? row.profile.provider;
  const model = args.model ?? row.profile.model;
  if (!provider || !model) {
    const missing = [!provider && "--provider <id>", !model && "--model <id>"].filter(Boolean).join(" and ");
    const modelHint = row.providerModelId ? ` The candidate's own model id is likely ${code(row.providerModelId)}.` : "";
    return {
      ok: false,
      text: `Candidate ${row.id} is not profileable: ${row.profile.reason}. Supply ${missing} to override (the plugin never guesses provider auth for you).${modelHint}`,
    };
  }
  return {
    ok: true,
    entry: {
      name: String(args.name),
      provider,
      model,
      guidance: `Model Feed: ${row.pricing.kind ?? "unknown"} ${row.capabilities.includes("coding") ? "coding" : "model"} candidate; verify provider credentials before use`,
    },
  };
}

function profileForRow(row) {
  if (!row.provider.id) return { profileable: false, nameSuggestion: "", provider: null, model: null, warnings: [], reason: "missing provider id" };
  if (row.visibility !== "listed") return { profileable: false, nameSuggestion: "", provider: row.provider.id, model: null, warnings: [], reason: "not listed" };
  if (["retired", "blocked", "deprecated"].includes(row.availability)) {
    return { profileable: false, nameSuggestion: "", provider: row.provider.id, model: null, warnings: [], reason: `availability is ${row.availability}` };
  }
  if (row.endpoint.protocol === "local_openai_compatible" || row.endpoint.protocol === "unknown") {
    return { profileable: false, nameSuggestion: "", provider: row.provider.id, model: null, warnings: [], reason: `protocol ${row.endpoint.protocol} needs manual provider setup` };
  }
  if (row.endpoint.baseUrl) {
    return { profileable: false, nameSuggestion: "", provider: row.provider.id, model: null, warnings: [], reason: "custom base URL needs manual provider setup" };
  }
  const model = row.endpoint.model || row.providerModelId;
  if (!model) return { profileable: false, nameSuggestion: "", provider: row.provider.id, model: null, warnings: [], reason: "missing model id" };
  return {
    profileable: true,
    nameSuggestion: slugName(`${row.provider.id}-${model}`),
    provider: row.provider.id,
    model,
    warnings: providerWarnings(row),
  };
}

function providerWarnings(row) {
  const warnings = [];
  if (requirementValue(row, "api_key") === true) warnings.push("provider API key required");
  if (requirementValue(row, "credit_card") === true) warnings.push("credit card may be required");
  return warnings;
}

function pricingExplanation(row) {
  const kind = row.pricing.kind ?? "unknown";
  const free = row.pricing.free;
  const parts = [String(kind)];
  if (free?.is_currently_free === true) parts.push(row.freeFresh ? "currently free" : "free claim stale or unverifiable");
  if (free?.quota) parts.push(`quota: ${free.quota}`);
  return parts.join("; ");
}

function requirementSummary(row) {
  const api = requirementValue(row, "api_key");
  const card = requirementValue(row, "credit_card");
  const account = row.pricing.free?.requires_account;
  const parts = [];
  if (account !== undefined && account !== null) parts.push(`account ${account ? "required" : "not required"}`);
  if (api !== null) parts.push(`API key ${api ? "required" : "not required"}`);
  if (card !== null) parts.push(`credit card ${card ? "required" : "not required"}`);
  return parts.join("; ");
}

function requirementValue(row, type) {
  if (type === "api_key") {
    if (typeof row.pricing.free?.requires_api_key === "boolean") return row.pricing.free.requires_api_key;
    if (row.providerAuth?.type) return row.providerAuth.type === "api_key";
  }
  if (type === "credit_card") {
    if (typeof row.pricing.free?.requires_credit_card === "boolean") return row.pricing.free.requires_credit_card;
    if (typeof row.providerSignup?.credit_card_required === "boolean") return row.providerSignup.credit_card_required;
  }
  return null;
}

function isStrictFreshFree(model, feed, nowIso) {
  const pricing = model?.pricing ?? {};
  const free = pricing.free ?? {};
  if (pricing.kind !== "free" || free.is_currently_free !== true) return false;
  const now = Date.parse(nowIso);
  if (free.expires_at && Date.parse(free.expires_at) <= now) return false;
  const verified = Date.parse(String(free.last_verified_at ?? ""));
  const staleAfterSeconds =
    numberOrNull(model?.availability?.stale_after_seconds) ??
    numberOrNull(feed?.feed?.default_stale_after_seconds);
  if (!Number.isFinite(now) || !Number.isFinite(verified) || !staleAfterSeconds) return false;
  return now - verified <= staleAfterSeconds * 1000;
}

function costForRow(row) {
  const input = numberOrNull(row.pricing.input_usd_per_1m_tokens);
  const output = numberOrNull(row.pricing.output_usd_per_1m_tokens);
  return {
    known: input !== null && output !== null,
    input: input ?? Number.POSITIVE_INFINITY,
    output: output ?? Number.POSITIVE_INFINITY,
  };
}

function statusRank(status) {
  return { available: 0, limited: 1, degraded: 2, unknown: 3, deprecated: 4, retired: 5, blocked: 6 }[status] ?? 3;
}

function pricingKindRank(kind) {
  return { free: 0, free_tier: 1, subscription_included: 2, trial: 3, local: 4, paid: 5, unknown: 6 }[kind] ?? 6;
}

function costFormula(args) {
  if (Number.isFinite(args.inputTokens) || Number.isFinite(args.outputTokens)) {
    return `Cost score: estimated cost for ${args.inputTokens || 0} input tokens and ${args.outputTokens || 0} output tokens.`;
  }
  return "Cost score: input_usd_per_1m_tokens + (3 * output_usd_per_1m_tokens).";
}

function assertSupportedFeed(feed) {
  if (feed?.schema_version !== FEED_SCHEMA_VERSION) {
    throw new Error(`Unsupported Model Feed schema_version ${feed?.schema_version ?? "(missing)"}; expected ${FEED_SCHEMA_VERSION}.`);
  }
}

function normalizeConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Model Feed config is empty.");
  return {
    schemaVersion: config.schemaVersion,
    feedBaseUrl: String(config.feedBaseUrl ?? ""),
    endpoints: {
      schema: String(config.endpoints?.schema ?? ""),
      status: String(config.endpoints?.status ?? ""),
      feed: String(config.endpoints?.feed ?? ""),
    },
    apiKey: config.apiKey ?? { type: "none" },
    cachePath: String(config.cachePath ?? modelFeedPaths().cachePath),
  };
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseBooleanArg(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizedLimit(limit) {
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;
}

function isOpenAiCompatible(protocol) {
  return protocol === "openai_chat_completions" || protocol === "openai_responses";
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hashText(text) {
  return createHash("sha256").update(text).digest("base64url");
}

function slugName(value) {
  return normalize(value).replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function code(value) {
  return `\`${String(value ?? "")}\``;
}

function describeApiKey(apiKey) {
  if (apiKey?.type === "none") return "none";
  if (apiKey?.type === "env") return `environment variable ${apiKey.name}`;
  if (apiKey?.type === "local-file") return "local secret file";
  return "unknown";
}

function redactSecrets(text) {
  return String(text ?? "").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function defaultDeps() {
  const paths = modelFeedPaths();
  return {
    env: process.env,
    paths: () => paths,
    readText: (path) => readFileSync(path, "utf8"),
    readConfig: () => readJsonIfExists(paths.configPath),
    writeConfig: (config) => writeJson(paths.configPath, config, 0o600),
    readSecret: (path) => readJsonIfExists(path).config ?? {},
    writeSecret: (path, secret) => writeJson(path, secret, 0o600),
    readCache: (path) => readJsonIfExists(path),
    writeCache: (path, cache) => writeJson(path, cache, 0o600),
    readProjectProfiles: readProjectProfiles,
    writeProjectProfiles: (path, doc) => writeJson(path, doc, 0o644),
    removeConfig: (path) => rmSync(path, { force: true }),
    removeCache: (path) => rmSync(path, { force: true }),
    fetchJson: async () => {
      throw new Error("fetchJson dependency not provided");
    },
  };
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return { error: { code: "missing", message: "missing" } };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { config: parsed, cache: parsed };
  } catch (error) {
    return { error: { code: "unreadable", message: error.message } };
  }
}

function writeJson(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
    try {
      chmodSync(tmpPath, mode);
    } catch {}
    renameSync(tmpPath, path);
    try {
      chmodSync(path, mode);
    } catch {}
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

function snapshotWritableFile(path, deps) {
  if (!existsSync(path)) return { exists: false };
  return { exists: true, value: deps.readText(path) };
}

function restoreWritableFile(path, snapshot, remove) {
  if (!snapshot.exists) {
    try {
      if (typeof remove === "function") remove(path);
      else rmSync(path, { force: true });
    } catch {}
    return;
  }
  try {
    writeTextFile(path, snapshot.value, 0o600);
  } catch {}
}

function writeTextFile(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, text, { encoding: "utf8", mode });
    try {
      chmodSync(tmpPath, mode);
    } catch {}
    renameSync(tmpPath, path);
    try {
      chmodSync(path, mode);
    } catch {}
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

function readProjectProfiles(startDir) {
  let dir = resolve(startDir || process.cwd());
  while (true) {
    const path = join(dir, ".cline-profiles.json");
    if (existsSync(path)) {
      try {
        return { path, dir, doc: JSON.parse(readFileSync(path, "utf8")) };
      } catch (error) {
        return { path, dir, error: error.message };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { path: null, dir: resolve(startDir || process.cwd()), doc: null };
    dir = parent;
  }
}

function renderModelFeedHelp() {
  return {
    ok: true,
    text: [
      "**Model Feed Help**",
      "",
      "Model Discovery Feed commands use a user-provided base URL and never assume a hosted feed.",
      "",
      "- `help`",
      "- `setup --base-url <url> --no-api-key`",
      "- `setup --base-url <url> --api-key-env <name>`",
      "- `setup --api-key-stdin` or `setup --api-key-file <path>` for terminal-only local secret storage",
      "- `setup --feed-url <url> [--status-url <url>] [--schema-url <url>]` for advanced non-standard deployments",
      "- `status`",
      "- `free-coding [--freeish] [--profileable]`",
      "- `cheapest --q <text>`",
      "- `cheapest --canonical-model <id>`",
      "- `suggest \"<wish or gap>\"`",
      "- `profile add --candidate <id> --name <name> [--write]`",
      "- `profile add --candidate <id> --name <name> --provider <id> --model <id> [--write]` for",
      "  candidates a plain `profile add` reports as \"not profileable\" (common for OpenRouter and",
      "  other custom-base-URL providers) — the error names exactly which of `--provider`/`--model`",
      "  is missing and suggests the likely `--model` value from the candidate's own id.",
      "",
      "Feed base URL and API key are user-provided; provider credentials are separate. This plugin",
      "never configures Cline provider auth for you — it assumes the provider (e.g. `openrouter`) is",
      "already authenticated in Cline, and the surest way to confirm a profile actually works is a",
      "real `/cline:delegate --profile <name> --plan \"...\"` run, not a config inspection.",
      "A deploy-your-own reference implementation lives at https://github.com/tm-henningnt/model-discovery-feed.",
    ].join("\n"),
  };
}

function formatCacheAge(fetchedAt, nowIso) {
  const fetched = Date.parse(fetchedAt ?? "");
  const now = Date.parse(nowIso ?? "");
  if (!Number.isFinite(fetched) || !Number.isFinite(now)) return "unknown";
  const deltaSeconds = Math.max(0, Math.floor((now - fetched) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 120) return `${deltaMinutes}m`;
  return `${Math.floor(deltaMinutes / 60)}h`;
}
