#!/usr/bin/env node
// Entry point invoked by the /cline:* slash commands. Parses the subcommand +
// arguments, wires real impure edges, and prints the handler's text to stdout
// for Claude Code to relay verbatim.
//
// Subprocess, settings file, and fetch usage live here; all logic lives in
// ./lib/*.mjs behind injected seams and is unit-tested there.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectClineAuth } from "./lib/auth.mjs";
import { parseDelegateArgs, parseReviewArgs, tokenize } from "./lib/argv.mjs";
import { delegate } from "./lib/delegate.mjs";
import { buildLedgerEntry } from "./lib/ledger.mjs";
import { review } from "./lib/review.mjs";
import {
  formatProfilesReport,
  profileNames,
  refreshModels,
  resolveProfile,
  setup,
  summarizeTestRun,
} from "./lib/setup.mjs";
import { redactAccountPath, usage } from "./lib/usage.mjs";

const DEFAULT_TIMEOUT_S = 600;
const DEFAULT_READONLY_TIMEOUT_S = 1800;
const WATCHDOG_MARGIN_MS =
  Number(process.env.CLINE_WATCHDOG_MARGIN_MS) > 0
    ? Number(process.env.CLINE_WATCHDOG_MARGIN_MS)
    : 120000;
const WATCHDOG_GRACE_MS =
  Number(process.env.CLINE_WATCHDOG_GRACE_MS) > 0
    ? Number(process.env.CLINE_WATCHDOG_GRACE_MS)
    : 5000;

const CLINEPASS_MODELS_PATH = fileURLToPath(
  new URL("../data/clinepass-models.json", import.meta.url),
);
const PROFILES_PATH = fileURLToPath(new URL("../data/profiles.json", import.meta.url));

function realRun(argv, { cwd, input, timeoutSeconds } = {}) {
  return new Promise((resolve) => {
    const child = spawn("cline", argv, { cwd: cwd || process.cwd() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timers = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolve(result);
    };
    const timeoutValue = Number(timeoutSeconds);
    // Cline also receives -t, but field logs show failure paths where it hangs
    // or outlives that timeout. Resolve ourselves even if `close` never fires.
    if (Number.isFinite(timeoutValue) && timeoutValue > 0) {
      timers.push(
        setTimeout(() => {
          stderr = `${stderr}\nrun timed out after ${timeoutValue}s (dispatcher watchdog killed the cline process)`.trim();
          try {
            child.kill("SIGTERM");
          } catch {}
          timers.push(
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {}
            }, WATCHDOG_GRACE_MS),
          );
          timers.push(
            setTimeout(() => finish({ stdout, stderr, exitCode: 1 }), WATCHDOG_GRACE_MS * 2),
          );
        }, timeoutValue * 1000 + WATCHDOG_MARGIN_MS),
      );
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A child that exits before draining stdin emits EPIPE on this stream;
    // without a listener that is an uncaught exception. The close handler
    // still reports the real exit code.
    child.stdin.on("error", () => {});
    child.on("error", (e) =>
      finish({ stdout, stderr: `${stderr}\n${e.message}`.trim(), exitCode: 127 }),
    );
    child.on("close", (code, signal) =>
      finish({
        stdout,
        stderr: signal ? `${stderr}\ncline terminated by ${signal}`.trim() : stderr,
        exitCode: code ?? (signal ? 1 : 0),
      }),
    );
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function realFetchJson(url, { token } = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let json;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const detail = json?.error?.message ?? json?.message ?? response.statusText;
    throw new Error(
      `${redactAccountPath(url)} returned ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`${redactAccountPath(url)} returned non-JSON response`);
  }

  return json;
}

async function realFetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain, text/html;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`);
  }

  return response.text();
}

function readStoredClineAuth() {
  const providersPath = join(homedir(), ".cline", "data", "settings", "providers.json");

  try {
    const providers = JSON.parse(readFileSync(providersPath, "utf8"));
    return { ...selectClineAuth(providers), status: "ok" };
  } catch (error) {
    const status = error?.code === "ENOENT" ? "missing" : "unreadable";
    return { token: "", accountId: "", model: null, provider: null, clinePassModel: null, status };
  }
}

async function getCliVersion() {
  const { stdout, stderr, exitCode } = await realRun(["--version"]);
  if (exitCode !== 0) return null;
  return String(stdout || stderr || "installed").trim();
}

function loadClinePassModels() {
  return JSON.parse(readFileSync(CLINEPASS_MODELS_PATH, "utf8"));
}

function loadProfiles() {
  return JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
}

function findProjectProfiles(startDir) {
  let dir = resolve(startDir || process.cwd());
  while (true) {
    const candidate = join(dir, ".cline-profiles.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8"));
        return {
          path: candidate,
          dir,
          profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
          ledger: parsed?.ledger === true,
        };
      } catch (error) {
        return { path: candidate, dir, error: error.message };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function writeClinePassModels(obj) {
  writeFileSync(CLINEPASS_MODELS_PATH, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

async function testClineRun() {
  const output = await realRun(
    // Cline's default timeout is 0 (none); this tiny validation Run should be bounded.
    ["--json", "-p", "-P", "cline-pass", "-t", "120", "reply with OK"],
    { cwd: process.cwd() },
  );
  return summarizeTestRun(output);
}

function runWithTimeout(timeoutSeconds) {
  return (argv, runOpts) => realRun(argv, { ...runOpts, timeoutSeconds });
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

// Resolves --profile into opts.provider/opts.model, or prints the error and
// exits. Shared by the delegate and review branches.
function applyProfileOrExit(opts, project) {
  if (opts.profile && (opts.model || opts.provider)) {
    process.stdout.write("Use either --profile or --model/--provider, not both.\n");
    process.exit(2);
  }
  if (!opts.profile) return;
  if (project?.error) {
    process.stdout.write(
      `Cannot use --profile: ${project.path} is unreadable (${project.error}).\n`,
    );
    process.exit(2);
  }
  const modelBundle = loadClinePassModels();
  const profileBundle = loadProfiles();
  const projectProfiles = project?.profiles ?? [];
  const resolved = resolveProfile(opts.profile, modelBundle.models, profileBundle.profiles, projectProfiles);
  if (!resolved) {
    const names = profileNames(modelBundle.models, profileBundle.profiles, projectProfiles);
    process.stdout.write(
      `Unknown profile "${opts.profile}". Available profiles: ${names.join(", ") || "(none bundled)"}\n`,
    );
    process.exit(2);
  }
  if (resolved.source === "project" && resolved.provider !== "cline-pass") {
    process.stdout.write(
      `Note: profile "${opts.profile}" (.cline-profiles.json) targets provider "${resolved.provider}" — this Run spends that subscription, not ClinePass.\n\n`,
    );
  }
  opts.provider = resolved.provider;
  if (resolved.model) opts.model = resolved.model;
}

function appendLedgerIfEnabled(project, { cmd, profile, opts, out, nowIso }) {
  if (project?.ledger !== true) return;
  try {
    const entry = buildLedgerEntry({ cmd, profile, opts, out, nowIso });
    appendFileSync(join(project.dir, ".cline-runs.ndjson"), `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  } catch (error) {
    process.stderr.write(`(cline ledger write failed: ${error.message})\n`);
  }
}

function readLedgerIfEnabled(project) {
  if (project?.ledger !== true) return {};
  const ledgerPath = join(project.dir, ".cline-runs.ndjson");
  if (!existsSync(ledgerPath)) return {};
  try {
    return { ledgerText: readFileSync(ledgerPath, "utf8"), ledgerPath };
  } catch {
    return {};
  }
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);

  if (subcommand === "delegate") {
    const opts = parseDelegateArgs(rest);
    if (!opts.prompt) {
      process.stdout.write("No task given. Usage: /cline:delegate \"<task>\"\n");
      process.exit(2);
    }
    if (!opts.cwd) opts.cwd = process.cwd();
    const project = findProjectProfiles(opts.cwd);
    applyProfileOrExit(opts, project);
    // Default timeout so a stuck Run can't block the session indefinitely
    // (cline's own default is 0 = no timeout). Override with --timeout.
    // Read-only Runs (--plan / --read-only) default to a longer timeout;
    // writing Runs stay at the shorter default.
    if (opts.timeoutSeconds == null || Number.isNaN(opts.timeoutSeconds)) {
      opts.timeoutSeconds = opts.plan || opts.readOnly ? DEFAULT_READONLY_TIMEOUT_S : DEFAULT_TIMEOUT_S;
    }
    const stdin = await readStdin();
    if (stdin.trim()) opts.stdin = stdin;
    const out = await delegate(opts, { run: runWithTimeout(opts.timeoutSeconds) });
    appendLedgerIfEnabled(project, {
      cmd: "delegate",
      profile: opts.profile ?? null,
      opts,
      out,
      nowIso: new Date().toISOString(),
    });
    process.stdout.write(out.text + "\n");
    process.exit(out.ok ? 0 : 1);
  }

  if (subcommand === "review") {
    const opts = parseReviewArgs(rest);
    if (!opts.cwd) opts.cwd = process.cwd();
    const project = findProjectProfiles(opts.cwd);
    applyProfileOrExit(opts, project);
    // Default timeout so a stuck Run can't block the session indefinitely
    // (cline's own default is 0 = no timeout). Override with --timeout.
    // Review is always plan mode (read-only), so use the longer default.
    if (opts.timeoutSeconds == null || Number.isNaN(opts.timeoutSeconds)) {
      opts.timeoutSeconds = DEFAULT_READONLY_TIMEOUT_S;
    }
    opts.diff = await readStdin();
    const out = await review(opts, { run: runWithTimeout(opts.timeoutSeconds) });
    appendLedgerIfEnabled(project, {
      cmd: "review",
      profile: opts.profile ?? null,
      opts,
      out,
      nowIso: new Date().toISOString(),
    });
    process.stdout.write(out.text + "\n");
    process.exit(out.ok ? 0 : 1);
  }

  if (subcommand === "usage") {
    const auth = readStoredClineAuth();
    const nowIso = new Date().toISOString();
    const out = await usage(
      {
        token: auth.token,
        accountId: auth.accountId,
        authStatus: auth.status,
        nowIso,
        ...readLedgerIfEnabled(findProjectProfiles(process.cwd())),
      },
      { fetchJson: realFetchJson },
    );
    process.stdout.write(out.text + "\n");
    process.exit(out.ok ? 0 : 1);
  }

  if (subcommand === "setup") {
    const args = rest.length === 1 ? tokenize(rest[0]) : rest;
    const out = args.includes("--refresh-models")
      ? await refreshModels(
          { nowIso: new Date().toISOString() },
          { fetchText: realFetchText, readModels: loadClinePassModels, writeModels: writeClinePassModels },
        )
      : await setup(
          { nowIso: new Date().toISOString() },
          {
            getCliVersion,
            readAuth: readStoredClineAuth,
            loadModels: loadClinePassModels,
            loadProfiles,
            loadProjectProfiles: () => findProjectProfiles(process.cwd()),
            testRun: testClineRun,
          },
        );
    process.stdout.write(out.text + "\n");
    process.exit(out.ok ? 0 : 1);
  }

  if (subcommand === "profiles") {
    const args = rest.length === 1 ? tokenize(rest[0]) : rest;
    const cwdIndex = args.indexOf("--cwd");
    const cwd = cwdIndex !== -1 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd();
    const modelBundle = loadClinePassModels();
    const profileBundle = loadProfiles();
    const out = formatProfilesReport({
      models: modelBundle.models,
      profiles: profileBundle.profiles,
      project: findProjectProfiles(cwd),
      pricingAsOf: modelBundle.pricingAsOf,
    });
    process.stdout.write(out + "\n");
    process.exit(0);
  }

  process.stdout.write(`Unknown subcommand: ${subcommand ?? "(none)"}\n`);
  process.exit(2);
}

main().catch((error) => {
  process.stdout.write(`cline plugin command failed: ${error.message}\n`);
  process.exit(1);
});
