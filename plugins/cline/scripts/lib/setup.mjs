import { formatRunFailure } from "./format.mjs";
import { extractResult } from "./parse-ndjson.mjs";

// The cline CLI version the NDJSON parsing and flags were verified against
// (docs/cline-cli-contract.md). Update when re-verifying against a newer cline.
export const VERIFIED_CLINE_VERSION = "3.0.37";

const CLINEPASS_DOCS_URL = "https://docs.cline.bot/getting-started/clinepass";
const CLINEPASS_MODELS_NOTE =
  "Bundled snapshot of ClinePass-covered models. Refresh with /cline:setup --refresh-models (re-scrapes cline-pass/* slugs from the source). Slug form is cline-pass/<model>.";

export function isClinePassModel(modelSlug, models = []) {
  const slug = String(modelSlug ?? "").trim();
  if (!slug) return false;
  if (slug.startsWith("cline-pass/")) return true;
  return normalizeModels(models).some((model) => model.slug === slug);
}

export function listProfileEntries(models = [], profiles = [], projectProfiles = []) {
  const derived = normalizeModels(models)
    .filter((model) => model.slug.startsWith("cline-pass/"))
    .map((model) => ({
      name: model.slug.slice("cline-pass/".length),
      provider: "cline-pass",
      model: model.slug,
      ...(model.guidance ? { guidance: model.guidance } : {}),
    }));
  const bundled = normalizeProfiles(profiles);
  const project = normalizeProfiles(projectProfiles);
  const builtInNames = new Set([...bundled, ...derived].map((profile) => profile.name));

  const entries = [];
  const seen = new Set();
  const add = (list, source) => {
    for (const profile of list) {
      if (seen.has(profile.name)) continue;
      seen.add(profile.name);
      entries.push({
        ...profile,
        source,
        overridesBuiltIn: source === "project" && builtInNames.has(profile.name),
      });
    }
  };
  add(project, "project");
  add(bundled, "built-in");
  add(derived, "clinepass-model");
  return entries;
}

export function profileNames(models = [], profiles = [], projectProfiles = []) {
  return listProfileEntries(models, profiles, projectProfiles).map((profile) => profile.name);
}

export function resolveProfile(profileName, models = [], profiles = [], projectProfiles = []) {
  const name = String(profileName ?? "").trim();
  if (!name) return null;
  const bare = name.startsWith("cline-pass/") ? name.slice("cline-pass/".length) : name;
  const match = listProfileEntries(models, profiles, projectProfiles).find(
    (profile) => profile.name === name || (profile.provider === "cline-pass" && profile.name === bare),
  );
  return match ? { provider: match.provider, model: match.model, source: match.source } : null;
}

export function formatProfilesReport({ models = [], profiles = [], project = null } = {}) {
  const lines = ["**Cline Profiles**", ""];
  if (project?.error) {
    lines.push(`- [ ] Project profiles: ${code(project.path)} found but unreadable (${project.error}).`);
  } else if (project?.path) {
    const count = normalizeProfiles(project.profiles).length;
    lines.push(`- [x] Project profiles: ${code(project.path)} (${count} profile${count === 1 ? "" : "s"}).`);
  } else {
    lines.push("- [ ] Project profiles: no `.cline-profiles.json` found — `/cline:setup` can scaffold one.");
  }
  lines.push("");
  const entries = listProfileEntries(models, profiles, project?.error ? [] : project?.profiles ?? []);
  for (const entry of entries) {
    const target = entry.model
      ? `provider ${code(entry.provider)}, model ${code(entry.model)}`
      : `provider ${code(entry.provider)}, model: provider default`;
    const source =
      entry.source === "project"
        ? entry.overridesBuiltIn
          ? "project (overrides built-in)"
          : "project"
        : entry.source === "built-in"
          ? "built-in"
          : "ClinePass model";
    const guidance = entry.guidance ? ` · ${entry.guidance}` : "";
    lines.push(`- ${code(entry.name)} → ${target} — ${source}${guidance}`);
  }
  lines.push("", "Use with `--profile <name>` on `/cline:delegate` and `/cline:review`.");
  return lines.join("\n");
}

export function extractClinePassSlugs(docsText) {
  const matches = String(docsText ?? "").matchAll(/cline-pass\/[a-z0-9][a-z0-9._-]*/g);
  // Bound a hostile or broken docs page; the real ClinePass list is small.
  return [...new Set([...matches].map((match) => match[0].replace(/[._-]+$/, "")))]
    .filter((slug) => slug.length <= 80)
    .sort()
    .slice(0, 100);
}

export function cliVersionMismatch(cliVersionString) {
  const version = String(cliVersionString ?? "").match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  if (!version || version === VERIFIED_CLINE_VERSION) return null;
  return version;
}

export function formatSetupReport(state) {
  const models = normalizeModels(state?.models ?? []);
  const lines = ["**Cline Setup**", ""];

  if (state?.cliVersion) {
    lines.push(`- [x] Cline CLI: installed (${code(state.cliVersion)}).`);
    const mismatchedVersion = cliVersionMismatch(state.cliVersion);
    if (mismatchedVersion) {
      lines.push(
        `- [ ] Version check: installed cline ${mismatchedVersion} differs from the verified ${VERIFIED_CLINE_VERSION} — flags/output parsing may have drifted. Runs still work unless you see parse errors.`,
      );
    }
  } else {
    lines.push("- [ ] Cline CLI: not found. Install with `npm i -g cline`.");
  }

  if (state?.signedIn) {
    lines.push("- [x] Sign-in: stored Cline OAuth token found.");
  } else if (state?.authStatus === "unreadable") {
    lines.push(
      "- [ ] Sign-in: settings file unreadable — fix or remove ~/.cline/data/settings/providers.json, then run `cline auth cline`.",
    );
  } else {
    lines.push("- [ ] Sign-in: not signed in. Run `cline auth cline`.");
  }

  if (state?.provider || state?.model) {
    lines.push(
      `- [x] Current provider/model: provider ${codeOrUnset(
        state.provider,
      )}, model ${codeOrUnset(state.model)}.`,
    );
  } else {
    lines.push("- [ ] Current provider/model: not configured.");
  }

  const runModel = normalizeNullable(state?.clinePassModel);
  if (runModel && isClinePassModel(runModel, models)) {
    lines.push(
      `- [x] Plugin Run default: provider \`cline-pass\`, model ${code(runModel)} (covered by ClinePass).`,
    );
  } else if (runModel) {
    lines.push(
      `- [ ] Plugin Run default: provider \`cline-pass\` is configured with ${code(runModel)}, which is not in the bundled ClinePass model list. Pick a covered model per Run with \`--profile <name>\` (see the profiles below).`,
    );
  } else {
    lines.push(
      "- [ ] Plugin Run default: no `cline-pass` model configured to check. Runs still pass `-P cline-pass`; pick a model per Run with `--profile <name>`.",
    );
  }

  if (state?.model && state?.modelCovered === false) {
    lines.push(
      `- Note: your cline CLI default (${code(state.model)}) is not ClinePass-covered; it only affects cline runs outside this plugin.`,
    );
  }

  if (state?.projectProfilesError) {
    lines.push(
      `- [ ] Project profiles: ${code(state.projectProfilesPath)} found but unreadable (${state.projectProfilesError}).`,
    );
  } else if (state?.projectProfilesPath) {
    const count = normalizeProfiles(state?.projectProfiles ?? []).length;
    lines.push(
      `- [x] Project profiles: ${code(state.projectProfilesPath)} (${count} profile${count === 1 ? "" : "s"}).`,
    );
  } else {
    lines.push("- [ ] Project profiles: no `.cline-profiles.json` found — `/cline:setup` can scaffold one.");
  }

  const availableProfiles = listProfileEntries(models, state?.profiles ?? [], state?.projectProfiles ?? []);
  if (availableProfiles.length) {
    lines.push("", "**Available profiles** (use with `--profile <name>` on delegate/review)");
    for (const profile of availableProfiles) {
      const target = profile.model
        ? `provider ${code(profile.provider)}, model ${code(profile.model)}`
        : `provider ${code(profile.provider)}, model: provider default`;
      const source =
        profile.source === "project"
          ? profile.overridesBuiltIn
            ? " — project (overrides built-in)"
            : " — project"
          : "";
      lines.push(`- ${code(profile.name)} → ${target}${source}`);
    }
  }

  if (state?.snapshotAgeDays > 90) {
    lines.push(
      `- [ ] Model snapshot: ${state.snapshotAgeDays} days old — refresh with /cline:setup --refresh-models.`,
    );
  }

  if (state?.testRun) {
    const status = state.testRun.ok ? "completed" : "failed";
    const detail = String(state.testRun.detail ?? "").trim();
    lines.push(`- [${state.testRun.ok ? "x" : " "}] Test Run: ${status}${detail ? ` - ${detail}` : ""}.`);
  } else {
    lines.push("- [ ] Test Run: skipped.");
  }

  return lines.join("\n");
}

export function summarizeTestRun({ stdout, stderr, exitCode }) {
  if (exitCode !== 0) {
    return { ok: false, detail: formatRunFailure(exitCode, stdout, stderr) };
  }

  const result = extractResult(stdout);
  if (!result.ok) {
    return {
      ok: false,
      detail: result.error ?? result.summary ?? `finished (${result.finishReason ?? "unknown"})`,
    };
  }

  return { ok: true, detail: result.summary || "completed" };
}

export async function setup(opts = {}, deps) {
  const cliVersion = normalizeNullable(await deps.getCliVersion());
  const auth = await deps.readAuth();
  const modelBundle = await deps.loadModels();
  const profileBundle = await deps.loadProfiles();
  const project = await deps.loadProjectProfiles();
  const models = normalizeModels(modelBundle?.models ?? []);
  const snapshotAgeDays = modelSnapshotAgeDays(modelBundle?.fetchedAt, opts.nowIso);
  const signedIn = Boolean(String(auth?.token ?? "").trim());
  const provider = normalizeNullable(auth?.provider);
  const model = normalizeNullable(auth?.model);
  const state = {
    cliVersion,
    signedIn,
    authStatus: auth?.status ?? null,
    provider,
    model,
    clinePassModel: normalizeNullable(auth?.clinePassModel),
    modelCovered: model ? isClinePassModel(model, models) : null,
    models,
    profiles: profileBundle?.profiles ?? [],
    projectProfiles: project?.error ? [] : project?.profiles ?? [],
    projectProfilesPath: project?.path ?? null,
    projectProfilesError: project?.error ?? null,
    snapshotAgeDays,
    testRun: null,
  };

  if (cliVersion && signedIn) {
    try {
      state.testRun = await deps.testRun(opts);
    } catch (error) {
      state.testRun = { ok: false, detail: error.message };
    }
  }

  return {
    ok: Boolean(cliVersion && signedIn && (state.testRun?.ok ?? true)),
    text: formatSetupReport(state),
  };
}

export async function refreshModels(opts = {}, deps) {
  const source = opts.source ?? CLINEPASS_DOCS_URL;
  const docsText = await deps.fetchText(source);
  const slugs = extractClinePassSlugs(docsText);

  if (slugs.length === 0) {
    return {
      ok: false,
      text: `No ClinePass models found at ${source}; bundled models were not changed.`,
    };
  }

  const currentModels = new Map(
    normalizeModels((await deps.readModels())?.models ?? []).map((model) => [model.slug, model]),
  );
  await deps.writeModels({
    source,
    note: CLINEPASS_MODELS_NOTE,
    fetchedAt: opts.nowIso ?? new Date().toISOString(),
    models: slugs.map((slug) => {
      const existing = currentModels.get(slug);
      return {
        slug,
        name: existing?.name || slug,
        ...(existing?.guidance ? { guidance: existing.guidance } : {}),
      };
    }),
  });

  return { ok: true, text: `Refreshed ${slugs.length} ClinePass models.` };
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((model) => ({
      slug: String(model?.slug ?? "").trim(),
      name: String(model?.name ?? "").trim(),
      guidance: String(model?.guidance ?? "").trim(),
    }))
    .filter((model) => model.slug);
}

function normalizeProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles
    .map((profile) => {
      const guidance = String(profile?.guidance ?? "").trim();
      return {
        name: String(profile?.name ?? "").trim(),
        provider: String(profile?.provider ?? "").trim(),
        model: String(profile?.model ?? "").trim() || null,
        ...(guidance ? { guidance } : {}),
      };
    })
    .filter((profile) => profile.name && profile.provider);
}

function normalizeNullable(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function modelSnapshotAgeDays(fetchedAt, nowIso) {
  const fetchedAtMs = Date.parse(String(fetchedAt ?? ""));
  const nowMs = Date.parse(String(nowIso ?? ""));
  if (!Number.isFinite(fetchedAtMs) || !Number.isFinite(nowMs)) return null;
  const ageDays = Math.floor((nowMs - fetchedAtMs) / 86_400_000);
  return ageDays >= 0 ? ageDays : null;
}

function code(value) {
  return `\`${String(value ?? "")}\``;
}

function codeOrUnset(value) {
  const normalized = normalizeNullable(value);
  return normalized ? code(normalized) : "(not set)";
}
