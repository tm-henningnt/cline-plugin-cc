import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cliVersionMismatch,
  extractClinePassSlugs,
  formatProfilesReport,
  formatSetupReport,
  isClinePassModel,
  listProfileEntries,
  profileNames,
  refreshModels,
  resolveProfile,
  setup,
  summarizeTestRun,
} from "../scripts/lib/setup.mjs";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url)),
  "utf8",
);

const MODELS = [
  { slug: "cline-pass/glm-5.2", name: "GLM-5.2" },
  { slug: "cline-pass/kimi-k2.7-code", name: "Kimi K2.7 Code", guidance: "coding tasks" },
  { slug: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max" },
];

const PROFILES = [
  { name: "cline", provider: "cline" },
  { name: "fast", provider: "acme", model: "acme/turbo" },
];

test("isClinePassModel: accepts listed and future cline-pass slugs only", () => {
  assert.equal(isClinePassModel("cline-pass/glm-5.2", MODELS), true);
  assert.equal(isClinePassModel("cline-pass/newer-model", MODELS), true);
  assert.equal(isClinePassModel("poolside/laguna-xs-2.1", MODELS), false);
});

test("profileNames: returns bare names in fixture order", () => {
  assert.deepEqual(profileNames(MODELS), ["glm-5.2", "kimi-k2.7-code", "qwen3.7-max"]);
});

test("resolveProfile: resolves a bare bundled model name", () => {
  assert.deepEqual(resolveProfile("glm-5.2", MODELS), {
    provider: "cline-pass",
    model: "cline-pass/glm-5.2",
    source: "clinepass-model",
  });
});

test("resolveProfile: accepts a full cline-pass slug", () => {
  assert.deepEqual(resolveProfile("cline-pass/glm-5.2", MODELS), {
    provider: "cline-pass",
    model: "cline-pass/glm-5.2",
    source: "clinepass-model",
  });
});

test("resolveProfile: unknown names return null", () => {
  assert.equal(resolveProfile("not-a-real-model", MODELS), null);
});

test("resolveProfile: blankish names return null", () => {
  assert.equal(resolveProfile("", MODELS), null);
  assert.equal(resolveProfile(undefined, MODELS), null);
});

test("profileNames: returns explicit profiles before derived ClinePass profiles", () => {
  assert.deepEqual(profileNames(MODELS, PROFILES), [
    "cline",
    "fast",
    "glm-5.2",
    "kimi-k2.7-code",
    "qwen3.7-max",
  ]);
});

test("resolveProfile: resolves provider-only explicit profiles", () => {
  assert.deepEqual(resolveProfile("cline", MODELS, PROFILES), {
    provider: "cline",
    model: null,
    source: "built-in",
  });
});

test("resolveProfile: resolves explicit provider and model profiles", () => {
  assert.deepEqual(resolveProfile("fast", MODELS, PROFILES), {
    provider: "acme",
    model: "acme/turbo",
    source: "built-in",
  });
});

test("resolveProfile: explicit profiles win clashes with derived names", () => {
  const profiles = [{ name: "glm-5.2", provider: "acme", model: "acme/override" }];

  assert.deepEqual(resolveProfile("glm-5.2", MODELS, profiles), {
    provider: "acme",
    model: "acme/override",
    source: "built-in",
  });
  assert.deepEqual(profileNames(MODELS, profiles), ["glm-5.2", "kimi-k2.7-code", "qwen3.7-max"]);
});

test("listProfileEntries: skips malformed entries", () => {
  assert.deepEqual(
    listProfileEntries([], [{ name: "", provider: "x" }, { provider: "y" }, { name: "ok", provider: "z" }]),
    [{ name: "ok", provider: "z", model: null, source: "built-in", overridesBuiltIn: false }],
  );
});

test("listProfileEntries: keeps the first duplicate explicit profile name", () => {
  assert.deepEqual(
    listProfileEntries([], [
      { name: "a", provider: "p1" },
      { name: "a", provider: "p2" },
    ]),
    [{ name: "a", provider: "p1", model: null, source: "built-in", overridesBuiltIn: false }],
  );
});

test("listProfileEntries: project profiles win before built-ins and derived models", () => {
  const projectProfiles = [
    { name: "glm-5.2", provider: "acme", model: "acme/x" },
    { name: "local", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" },
  ];

  const entries = listProfileEntries(MODELS, PROFILES, projectProfiles);

  assert.deepEqual(entries[0], {
    name: "glm-5.2",
    provider: "acme",
    model: "acme/x",
    source: "project",
    overridesBuiltIn: true,
  });
  assert.deepEqual(entries[1], {
    name: "local",
    provider: "cline-pass",
    model: "cline-pass/deepseek-v4-flash",
    source: "project",
    overridesBuiltIn: false,
  });
  assert.equal(entries.filter((entry) => entry.name === "glm-5.2").length, 1);
  assert.deepEqual(profileNames(MODELS, PROFILES, projectProfiles), [
    "glm-5.2",
    "local",
    "cline",
    "fast",
    "kimi-k2.7-code",
    "qwen3.7-max",
  ]);
});

test("listProfileEntries: non-shadowing project profiles are not marked as overrides", () => {
  const entries = listProfileEntries(MODELS, PROFILES, [
    { name: "local", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" },
  ]);

  assert.equal(entries[0].name, "local");
  assert.equal(entries[0].source, "project");
  assert.equal(entries[0].overridesBuiltIn, false);
});

test("listProfileEntries: derived ClinePass entries carry guidance when present", () => {
  const entries = listProfileEntries(MODELS);

  assert.equal(entries.find((entry) => entry.name === "kimi-k2.7-code")?.guidance, "coding tasks");
});

test("listProfileEntries: entries without guidance stay unannotated", () => {
  const entries = listProfileEntries(MODELS);

  assert.equal(Object.hasOwn(entries.find((entry) => entry.name === "qwen3.7-max") ?? {}, "guidance"), false);
});

test("listProfileEntries: explicit profile guidance is preserved", () => {
  const entries = listProfileEntries([], [{ name: "design", provider: "cline", guidance: "taste checks" }]);

  assert.deepEqual(entries[0], {
    name: "design",
    provider: "cline",
    model: null,
    guidance: "taste checks",
    source: "built-in",
    overridesBuiltIn: false,
  });
});

test("resolveProfile: resolves project entries with source", () => {
  const projectProfiles = [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }];

  assert.deepEqual(resolveProfile("quick", MODELS, PROFILES, projectProfiles), {
    provider: "cline-pass",
    model: "cline-pass/deepseek-v4-flash",
    source: "project",
  });
});

test("resolveProfile: project entries override built-ins", () => {
  const projectProfiles = [{ name: "fast", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }];

  assert.deepEqual(resolveProfile("fast", MODELS, PROFILES, projectProfiles), {
    provider: "cline-pass",
    model: "cline-pass/deepseek-v4-flash",
    source: "project",
  });
});

test("profileNames: puts project profile names first", () => {
  const projectProfiles = [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }];

  assert.deepEqual(profileNames(MODELS, PROFILES, projectProfiles), [
    "quick",
    "cline",
    "fast",
    "glm-5.2",
    "kimi-k2.7-code",
    "qwen3.7-max",
  ]);
});

test("extractClinePassSlugs: returns unique sorted ClinePass slugs", () => {
  const text = [
    "Use cline-pass/qwen3.7-max for coding.",
    "Noise: poolside/laguna-xs-2.1 and anthropic/claude-sonnet-4.6.",
    "Also cline-pass/glm-5.2, cline-pass/kimi-k2.7-code, and cline-pass/glm-5.2.",
  ].join("\n");

  assert.deepEqual(extractClinePassSlugs(text), [
    "cline-pass/glm-5.2",
    "cline-pass/kimi-k2.7-code",
    "cline-pass/qwen3.7-max",
  ]);
});

test("extractClinePassSlugs: bounds hostile docs output", () => {
  const slugs = Array.from({ length: 150 }, (_, index) => {
    return `cline-pass/model-${String(index).padStart(3, "0")}`;
  });
  const overlongSlug = `cline-pass/${"a".repeat(200)}`;

  const extracted = extractClinePassSlugs([...slugs, overlongSlug].join("\n"));

  assert.equal(extracted.length, 100);
  assert.equal(extracted.includes(overlongSlug), false);
});

test("cliVersionMismatch: extracts semver and ignores verified or unknown versions", () => {
  assert.equal(cliVersionMismatch("3.0.37"), null);
  assert.equal(cliVersionMismatch("cline 3.0.37"), null);
  assert.equal(cliVersionMismatch("cline 3.2.0"), "3.2.0");
  assert.equal(cliVersionMismatch("installed"), null);
});

test("formatSetupReport: warns when installed cline differs from the verified version", () => {
  const mismatched = formatSetupReport({
    cliVersion: "3.2.0",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    testRun: null,
  });
  assert.match(mismatched, /differs from the verified 3\.0\.37/);

  const verified = formatSetupReport({
    cliVersion: "3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    testRun: null,
  });
  assert.doesNotMatch(verified, /differs from the verified 3\.0\.37/);
});

test("formatSetupReport: covers sign-in, uncovered warning, and covered state", () => {
  const signedOut = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: false,
    provider: null,
    model: null,
    modelCovered: null,
    models: MODELS,
    testRun: null,
  });
  assert.match(signedOut, /Run `cline auth cline`/);

  const uncovered = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "poolside/laguna-xs-2.1",
    clinePassModel: "cline-pass/glm-5.2",
    modelCovered: false,
    models: MODELS,
    testRun: null,
  });
  assert.match(
    uncovered,
    /Plugin Run default: provider `cline-pass`, model `cline-pass\/glm-5\.2` \(covered by ClinePass\)/,
  );
  assert.match(
    uncovered,
    /Note: your cline CLI default \(`poolside\/laguna-xs-2\.1`\) is not ClinePass-covered/,
  );
  assert.doesNotMatch(uncovered, /cline auth --provider/);
  assert.doesNotMatch(uncovered, /Available ClinePass models/);

  const covered = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    clinePassModel: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    testRun: { ok: true, detail: "OK" },
  });
  assert.match(
    covered,
    /Plugin Run default: provider `cline-pass`, model `cline-pass\/glm-5\.2` \(covered by ClinePass\)/,
  );
  assert.doesNotMatch(covered, /Note: your cline CLI default/);
});

test("formatSetupReport: warns when plugin run model is not covered", () => {
  const text = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    clinePassModel: "poolside/laguna-xs-2.1",
    modelCovered: true,
    models: MODELS,
    testRun: null,
  });

  assert.match(text, /Plugin Run default: provider `cline-pass` is configured with/);
  assert.match(text, /--profile <name>/);
});

test("formatSetupReport: reports missing plugin run model", () => {
  const text = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    testRun: null,
  });

  assert.match(text, /no `cline-pass` model configured to check/);
});

test("formatSetupReport: lists available profile names", () => {
  const text = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    profiles: PROFILES,
    projectProfiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
    projectProfilesPath: "/tmp/example/.cline-profiles.json",
    testRun: null,
  });

  assert.match(text, /Project profiles: `\/tmp\/example\/\.cline-profiles\.json` \(1 profile\)/);
  assert.match(text, /Available profiles/);
  assert.match(text, /`quick` → provider `cline-pass`, model `cline-pass\/deepseek-v4-flash` — project/);
  assert.match(text, /`cline` → provider `cline`, model: provider default/);
  assert.match(text, /`glm-5\.2` → provider `cline-pass`, model `cline-pass\/glm-5\.2`/);
});

test("formatProfilesReport: lists project, built-in, and ClinePass model sources", () => {
  const text = formatProfilesReport({
    models: MODELS,
    profiles: PROFILES,
    project: {
      path: "/tmp/example/.cline-profiles.json",
      profiles: [
        { name: "glm-5.2", provider: "acme", model: "acme/x" },
        { name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" },
      ],
    },
  });

  assert.match(text, /\[x\] Project profiles: `\/tmp\/example\/\.cline-profiles\.json` \(2 profiles\)/);
  assert.match(text, /`glm-5\.2` → provider `acme`, model `acme\/x` — project \(overrides built-in\)/);
  assert.match(text, /`quick` → provider `cline-pass`, model `cline-pass\/deepseek-v4-flash` — project/);
  assert.match(text, /— built-in/);
  assert.match(text, /— ClinePass model/);
  assert.match(
    text,
    /`kimi-k2\.7-code` → provider `cline-pass`, model `cline-pass\/kimi-k2\.7-code` — ClinePass model · coding tasks/,
  );
  assert.match(
    text,
    /`qwen3\.7-max` → provider `cline-pass`, model `cline-pass\/qwen3\.7-max` — ClinePass model\n/,
  );
});

test("formatProfilesReport: appends guidance only when present", () => {
  const text = formatProfilesReport({ models: MODELS, profiles: [], project: null });

  assert.match(
    text,
    /`kimi-k2\.7-code` → provider `cline-pass`, model `cline-pass\/kimi-k2\.7-code` — ClinePass model · coding tasks/,
  );
  assert.match(
    text,
    /`qwen3\.7-max` → provider `cline-pass`, model `cline-pass\/qwen3\.7-max` — ClinePass model\n/,
  );
});

test("formatProfilesReport: reports when no project file is found", () => {
  const text = formatProfilesReport({ models: MODELS, profiles: PROFILES, project: null });

  assert.match(text, /no `\.cline-profiles\.json` found/);
});

test("formatProfilesReport: reports unreadable project files and still lists built-ins", () => {
  const text = formatProfilesReport({
    models: MODELS,
    profiles: PROFILES,
    project: { path: "/tmp/example/.cline-profiles.json", error: "Expected property name" },
  });

  assert.match(text, /unreadable/);
  assert.match(text, /`cline` → provider `cline`, model: provider default — built-in/);
  assert.match(text, /— ClinePass model/);
});

test("setup: signed-in covered model runs the validation Run and reports ok", async () => {
  let testRunAttempted = false;
  const out = await setup(
    {},
    {
      getCliVersion: async () => "cline 3.0.37",
      readAuth: async () => ({
        token: "oauth-token",
        accountId: "usr-EXAMPLE",
        provider: "cline",
        model: "cline-pass/glm-5.2",
        clinePassModel: "cline-pass/glm-5.2",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: [] }),
      loadProjectProfiles: async () => null,
      testRun: async () => {
        testRunAttempted = true;
        return { ok: true, detail: "OK" };
      },
    },
  );

  assert.equal(out.ok, true);
  assert.equal(testRunAttempted, true);
  assert.match(out.text, /cline 3\.0\.37/);
  assert.match(out.text, /cline-pass\/glm-5\.2/);
  assert.match(out.text, /Plugin Run default/);
});

test("setup: reports explicit profiles loaded through deps", async () => {
  const out = await setup(
    {},
    {
      getCliVersion: async () => "cline 3.0.37",
      readAuth: async () => ({
        token: "oauth-token",
        accountId: "usr-EXAMPLE",
        provider: "cline",
        model: "cline-pass/glm-5.2",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: PROFILES }),
      loadProjectProfiles: async () => null,
      testRun: async () => ({ ok: true, detail: "OK" }),
    },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /`cline` → provider/);
});

test("setup: reports project profiles loaded through deps", async () => {
  const out = await setup(
    {},
    {
      getCliVersion: async () => "cline 3.0.37",
      readAuth: async () => ({
        token: "oauth-token",
        accountId: "usr-EXAMPLE",
        provider: "cline",
        model: "cline-pass/glm-5.2",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: PROFILES }),
      loadProjectProfiles: async () => ({
        path: "/tmp/example/.cline-profiles.json",
        profiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
      }),
      testRun: async () => ({ ok: true, detail: "OK" }),
    },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /Project profiles: `\/tmp\/example\/\.cline-profiles\.json` \(1 profile\)/);
  assert.match(out.text, /`quick` → provider `cline-pass`, model `cline-pass\/deepseek-v4-flash` — project/);
});

test("setup: warns when bundled model snapshot is stale", async () => {
  const depsFor = (fetchedAt) => ({
    getCliVersion: async () => "3.0.37",
    readAuth: async () => ({
      token: "",
      accountId: "",
      provider: "cline",
      model: "cline-pass/glm-5.2",
    }),
    loadModels: async () => ({ fetchedAt, models: MODELS }),
    loadProfiles: async () => ({ profiles: [] }),
    loadProjectProfiles: async () => null,
    testRun: async () => {
      throw new Error("testRun should not be called");
    },
  });

  const stale = await setup(
    { nowIso: "2026-07-04T00:00:00.000Z" },
    depsFor("2026-01-01T00:00:00.000Z"),
  );
  assert.match(stale.text, /days old — refresh/);

  const fresh = await setup(
    { nowIso: "2026-07-04T00:00:00.000Z" },
    depsFor("2026-06-01T00:00:00.000Z"),
  );
  assert.doesNotMatch(fresh.text, /days old — refresh/);
});

test("setup: missing cli reports the install hint and skips the validation Run", async () => {
  let testRunAttempted = false;
  const out = await setup(
    {},
    {
      getCliVersion: async () => null,
      readAuth: async () => ({
        token: "oauth-token",
        accountId: "usr-EXAMPLE",
        provider: "cline",
        model: "cline-pass/glm-5.2",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: [] }),
      loadProjectProfiles: async () => null,
      testRun: async () => {
        testRunAttempted = true;
        return { ok: true, detail: "OK" };
      },
    },
  );

  assert.equal(out.ok, false);
  assert.equal(testRunAttempted, false);
  assert.match(out.text, /npm i -g cline/);
});

test("setup: unreadable auth settings reports repair guidance", async () => {
  const out = await setup(
    {},
    {
      getCliVersion: async () => "cline 3.0.37",
      readAuth: async () => ({
        token: "",
        accountId: "",
        provider: "cline",
        model: "cline-pass/glm-5.2",
        status: "unreadable",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: [] }),
      loadProjectProfiles: async () => null,
      testRun: async () => {
        throw new Error("testRun should not be called");
      },
    },
  );

  assert.equal(out.ok, false);
  assert.match(out.text, /settings file unreadable/);
});

test("setup: a throwing test Run is caught and reported as failed", async () => {
  const out = await setup(
    {},
    {
      getCliVersion: async () => "cline 3.0.37",
      readAuth: async () => ({
        token: "oauth-token",
        accountId: "usr-EXAMPLE",
        provider: "cline",
        model: "cline-pass/glm-5.2",
      }),
      loadModels: async () => ({ models: MODELS }),
      loadProfiles: async () => ({ profiles: [] }),
      loadProjectProfiles: async () => null,
      testRun: async () => {
        throw new Error("provider rejected");
      },
    },
  );

  assert.equal(out.ok, false);
  assert.match(out.text, /Test Run: failed - provider rejected/);
});

test("formatSetupReport: a failed test Run reports the checkbox and detail", () => {
  const text = formatSetupReport({
    cliVersion: "cline 3.0.37",
    signedIn: true,
    provider: "cline",
    model: "cline-pass/glm-5.2",
    modelCovered: true,
    models: MODELS,
    testRun: { ok: false, detail: "exit 1" },
  });
  assert.match(text, /- \[ \] Test Run: failed - exit 1\./);
});

test("summarizeTestRun: reports non-zero exits with the stderr tail", () => {
  const out = summarizeTestRun({
    stdout: "",
    stderr: ["one", "two", "three", "four", "five", "six"].join("\n"),
    exitCode: 2,
  });

  assert.equal(out.ok, false);
  assert.match(out.detail, /Cline exited with code 2/);
  assert.match(out.detail, /two\nthree\nfour\nfive\nsix/);
  assert.doesNotMatch(out.detail, /one/);
});

test("summarizeTestRun: reports a completed validation Run summary", () => {
  const out = summarizeTestRun({ stdout: fixture, stderr: "", exitCode: 0 });

  assert.equal(out.ok, true);
  assert.match(out.detail, /hello\.txt/);
});

test("summarizeTestRun: reports exit 0 without a run_result as not ok", () => {
  const out = summarizeTestRun({
    stdout: '{"type":"hook_event","hookEventName":"agent_start"}',
    stderr: "",
    exitCode: 0,
  });

  assert.equal(out.ok, false);
});

test("refreshModels: writes slugs extracted from fetched docs", async () => {
  let written = null;
  const out = await refreshModels(
    { nowIso: "2026-07-04T00:00:00.000Z" },
    {
      fetchText: async (url) => {
        assert.equal(url, "https://docs.cline.bot/getting-started/clinepass");
        return [
          "cline-pass/qwen3.7-max",
          "cline-pass/glm-5.2",
          "poolside/laguna-xs-2.1",
          "cline-pass/kimi-k2.7-code",
          "cline-pass/glm-5.2",
        ].join("\n");
      },
      readModels: async () => ({ models: [] }),
      writeModels: async (obj) => {
        written = obj;
      },
    },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /Refreshed 3 ClinePass models/);
  assert.deepEqual(
    written.models.map((model) => model.slug),
    ["cline-pass/glm-5.2", "cline-pass/kimi-k2.7-code", "cline-pass/qwen3.7-max"],
  );
  assert.deepEqual(
    written.models.map((model) => model.name),
    ["cline-pass/glm-5.2", "cline-pass/kimi-k2.7-code", "cline-pass/qwen3.7-max"],
  );
  assert.equal(written.fetchedAt, "2026-07-04T00:00:00.000Z");
});

test("refreshModels: empty docs do not write", async () => {
  let writeAttempted = false;
  const out = await refreshModels(
    {},
    {
      fetchText: async () => "poolside/laguna-xs-2.1 only",
      readModels: async () => {
        throw new Error("readModels should not be called for empty docs");
      },
      writeModels: async () => {
        writeAttempted = true;
      },
    },
  );

  assert.equal(out.ok, false);
  assert.equal(writeAttempted, false);
});

test("refreshModels: preserves hand-maintained fields for surviving slugs", async () => {
  let written = null;
  const out = await refreshModels(
    { nowIso: "2026-07-04T00:00:00.000Z", source: "https://example.test/models" },
    {
      fetchText: async () => [
        "cline-pass/glm-5.2",
        "cline-pass/new-model",
        "cline-pass/qwen3.7-max",
      ].join("\n"),
      readModels: async () => ({
        models: [
          { slug: "cline-pass/glm-5.2", name: "GLM-5.2", guidance: "deep reasoning" },
          { slug: "cline-pass/dropped", name: "Dropped", guidance: "old" },
          { slug: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max", guidance: "heavy workloads" },
        ],
      }),
      writeModels: async (obj) => {
        written = obj;
      },
    },
  );

  assert.equal(out.ok, true);
  assert.deepEqual(written.models, [
    { slug: "cline-pass/glm-5.2", name: "GLM-5.2", guidance: "deep reasoning" },
    { slug: "cline-pass/new-model", name: "cline-pass/new-model" },
    { slug: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max", guidance: "heavy workloads" },
  ]);
});
