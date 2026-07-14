#!/usr/bin/env node
// Entry point invoked by the /cline:* slash commands. Parses the subcommand +
// arguments, wires real impure edges, and prints the handler's text to stdout
// for Claude Code to relay verbatim.
//
// Subprocess, settings file, and fetch usage live here; all logic lives in
// ./lib/*.mjs behind injected seams and is unit-tested there.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, appendFileSync, constants, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectClineAuth } from "./lib/auth.mjs";
import { parseDelegateArgs, parseReviewArgs, tokenize } from "./lib/argv.mjs";
import { delegate } from "./lib/delegate.mjs";
import { buildLedgerEntry } from "./lib/ledger.mjs";
import { handleModelFeed } from "./lib/model-feed.mjs";
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
import { resolveClineState, withClineState } from "./lib/host-state.mjs";

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
const STALL_TIMEOUT_MS =
  Number(process.env.CLINE_STALL_TIMEOUT_MS) > 0
    ? Number(process.env.CLINE_STALL_TIMEOUT_MS)
    : 180000;
const HEARTBEAT_INTERVAL_MS =
  Number(process.env.CLINE_HEARTBEAT_MS) >= 0
    ? Number(process.env.CLINE_HEARTBEAT_MS)
    : 30000;

const CLINEPASS_MODELS_PATH = fileURLToPath(
  new URL("../data/clinepass-models.json", import.meta.url),
);
const PROFILES_PATH = fileURLToPath(new URL("../data/profiles.json", import.meta.url));

function realRun(argv, { cwd, input, timeoutSeconds, clineState } = {}) {
  return new Promise((resolve) => {
    const child = spawn("cline", withClineState(argv, clineState), { cwd: cwd || process.cwd() });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let heartbeat = null;
    const timers = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      resolve(result);
    };
    const killLadder = () => {
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
    };
    const timeoutValue = Number(timeoutSeconds);
    // Cline also receives -t, but field logs show failure paths where it hangs
    // or outlives that timeout. Resolve ourselves even if `close` never fires.
    let sawOutput = false;
    if (Number.isFinite(timeoutValue) && timeoutValue > 0) {
      timers.push(
        setTimeout(() => {
          stderr = `${stderr}\nrun timed out after ${timeoutValue}s (dispatcher watchdog killed the cline process)`.trim();
          killLadder();
        }, timeoutValue * 1000 + WATCHDOG_MARGIN_MS),
      );

      if (STALL_TIMEOUT_MS < timeoutValue * 1000 + WATCHDOG_MARGIN_MS) {
        timers.push(
          setTimeout(() => {
            if (sawOutput) return;
            stderr = `${stderr}\nno output from cline within ${Math.round(STALL_TIMEOUT_MS / 1000)}s (dispatcher stall watchdog killed the cline process — likely cline CLI/hub-daemon contention; dispatch serially before retrying)`.trim();
            killLadder();
          }, STALL_TIMEOUT_MS),
        );
      }

      if (HEARTBEAT_INTERVAL_MS > 0) {
        const startedAt = Date.now();
        heartbeat = setInterval(() => {
          const events = stdout.length === 0 ? 0 : stdout.split("\n").filter((l) => l.trim()).length;
          process.stderr.write(
            `cline-dispatch: {"heartbeat":true,"elapsedS":${Math.round((Date.now() - startedAt) / 1000)},"stdoutBytes":${stdout.length},"events":${events}}\n`,
          );
        }, HEARTBEAT_INTERVAL_MS);
      }
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      sawOutput = true;
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      sawOutput = true;
      stderr += d;
    });
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

async function realModelFeedFetchJson(url, { headers = {} } = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });

  const result = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: {
      etag: response.headers.get("ETag"),
      lastModified: response.headers.get("Last-Modified"),
    },
    body: null,
  };
  if (response.status === 304) return result;
  try {
    result.body = await response.json();
  } catch {
    result.body = null;
  }
  return result;
}

function readStoredClineAuth(clineState = {}) {
  if (clineState.host && !clineState.ok) {
    return {
      token: "",
      accountId: "",
      model: null,
      provider: null,
      clinePassModel: null,
      status: "missing",
      settingsPath: null,
    };
  }
  const stateRoot = clineState.stateRoot ?? join(homedir(), ".cline");
  const providersPaths = [
    join(stateRoot, "data", "settings", "providers.json"),
    join(stateRoot, "settings", "providers.json"),
  ];

  for (const settingsPath of providersPaths) {
    try {
      const providers = JSON.parse(readFileSync(settingsPath, "utf8"));
      return { ...selectClineAuth(providers), status: "ok", settingsPath };
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      return {
        token: "",
        accountId: "",
        model: null,
        provider: null,
        clinePassModel: null,
        status: "unreadable",
        settingsPath,
      };
    }
  }

  return {
    token: "",
    accountId: "",
    model: null,
    provider: null,
    clinePassModel: null,
    status: "missing",
    settingsPath: providersPaths.at(-1),
  };
}

function inspectClineState(clineState) {
  if (!clineState?.stateRoot) return null;
  if (!clineState.ok) return { ok: false, status: "unsafe", path: clineState.stateRoot };
  try {
    const stat = statSync(clineState.stateRoot);
    if (!stat.isDirectory()) return { ok: false, status: "not-directory", path: clineState.stateRoot };
    accessSync(clineState.stateRoot, constants.W_OK);
    return { ok: true, status: "ready", path: clineState.stateRoot };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, status: "missing", path: clineState.stateRoot };
    return { ok: false, status: "unwritable", path: clineState.stateRoot };
  }
}

async function getCliVersion(clineState) {
  const { stdout, stderr, exitCode } = await realRun(["--version"], { clineState });
  if (exitCode !== 0) return null;
  return String(stdout || stderr || "installed").trim();
}

function loadClinePassModels() {
  return JSON.parse(readFileSync(CLINEPASS_MODELS_PATH, "utf8"));
}

function loadProfiles() {
  return JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
}

// A linked git worktree's .git is a FILE pointing into the main repo's
// .git/worktrees/<name>. Resolve the main working tree root from it via the
// commondir file — plain fs, no git subprocess. Returns null when cwd is not
// inside a linked worktree (or anything is unexpected).
function findMainWorktreeRoot(startDir) {
  let dir = resolve(startDir || process.cwd());
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      let stat;
      try {
        stat = statSync(gitPath);
      } catch {
        return null;
      }
      if (!stat.isFile()) return null; // main worktree or bare layout — no fallback
      try {
        const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, "utf8"));
        if (!m) return null;
        const gitDir = resolve(dir, m[1].trim());
        // Linked-worktree layouts only: a submodule's .git file points at
        // .git/modules/<name> and must NOT trigger the fallback.
        if (!/[\\/]worktrees[\\/]/.test(gitDir)) return null;
        const commonDirFile = join(gitDir, "commondir");
        const commonDir = existsSync(commonDirFile)
          ? resolve(gitDir, readFileSync(commonDirFile, "utf8").trim())
          : /[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.test(gitDir)
            ? dirname(dirname(gitDir))
            : null;
        if (!commonDir) return null;
        const mainRoot = dirname(commonDir);
        return mainRoot === dir ? null : mainRoot;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function walkForProfiles(startDir) {
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

function findProjectProfiles(startDir) {
  const direct = walkForProfiles(startDir);
  if (direct) return direct;
  const mainRoot = findMainWorktreeRoot(startDir);
  return mainRoot ? walkForProfiles(mainRoot) : null;
}

// Explicit profiles-file override: fail closed — a named file that can't be
// used must never silently fall back to inferred resolution.
function loadProfilesFileOrExit(profilesFile) {
  const path = resolve(profilesFile);
  if (!existsSync(path)) {
    process.stdout.write(`--profiles-file: ${path} not found.\n`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      path,
      dir: dirname(path),
      profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
      ledger: parsed?.ledger === true,
    };
  } catch (error) {
    process.stdout.write(`--profiles-file: ${path} is unreadable (${error.message}).\n`);
    process.exit(2);
  }
}

// Best-effort branch echo so the banner shows which tree/branch the Run targets
// (a field incident had a Run operate on the wrong tree, caught only by prose).
// Zero-dep: reads .git directly; returns null on any surprise.
function readGitBranch(cwd) {
  try {
    const gitPath = join(resolve(cwd), ".git");
    let gitDir = gitPath;
    if (statSync(gitPath).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, "utf8"));
      if (!m) return null;
      gitDir = resolve(dirname(gitPath), m[1].trim());
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return ref ? ref[1] : `${head.slice(0, 12)} (detached)`;
  } catch {
    return null;
  }
}

function writeClinePassModels(obj) {
  writeFileSync(CLINEPASS_MODELS_PATH, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

async function testClineRun(clineState) {
  const output = await realRun(
    // Cline's default timeout is 0 (none); this tiny validation Run should be bounded.
    ["--json", "-p", "-P", "cline-pass", "-t", "120", "reply with OK"],
    { cwd: process.cwd(), clineState },
  );
  return summarizeTestRun(output);
}

function runWithTimeout(timeoutSeconds, clineState) {
  return (argv, runOpts) => realRun(argv, { ...runOpts, timeoutSeconds, clineState });
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
      `Note: profile "${opts.profile}" (${project.path}) targets provider "${resolved.provider}" — this Run spends that subscription, not ClinePass.\n\n`,
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
  const invocationCwd = process.cwd();
  const clineState = resolveClineState({ invocationCwd });

  if (subcommand === "delegate") {
    const opts = parseDelegateArgs(rest);
    if (opts.help) {
      process.stdout.write(
        'Usage: /cline:delegate [--model <id>] [--profile <name>] [--provider <id>] [--plan] [--read-only] [--timeout <s>] [--cwd <path>] [--profiles-file <path>] "<task>"\n',
      );
      process.exit(0);
    }
    if (!opts.prompt) {
      process.stdout.write("No task given. Usage: /cline:delegate \"<task>\"\n");
      process.exit(2);
    }
    if (!opts.cwd) opts.cwd = process.cwd();
    const runClineState = resolveClineState({ cwd: opts.cwd, invocationCwd });
    if (!runClineState.ok) {
      process.stdout.write(`${runClineState.text}\n`);
      process.exit(2);
    }
    // --profiles-file overrides inferred resolution; a relative path resolves
    // against the dispatcher process's cwd (per resolve()), not --cwd.
    // When followed by another recognized flag it parses as undefined and
    // falls back to inferred resolution — matching other value-flag semantics.
    const project = opts.profilesFile
      ? loadProfilesFileOrExit(opts.profilesFile)
      : findProjectProfiles(opts.cwd);
    applyProfileOrExit(opts, project);
    // Default timeout so a stuck Run can't block the session indefinitely
    // (cline's own default is 0 = no timeout). Override with --timeout.
    // Read-only Runs (--plan / --read-only) default to a longer timeout;
    // writing Runs stay at the shorter default.
    if (opts.timeoutSeconds == null || Number.isNaN(opts.timeoutSeconds)) {
      opts.timeoutSeconds = opts.plan || opts.readOnly ? DEFAULT_READONLY_TIMEOUT_S : DEFAULT_TIMEOUT_S;
    }
    opts.runId = randomUUID().slice(0, 8);
    process.stdout.write(
      `cline-dispatch: ${JSON.stringify({
        runId: opts.runId,
        ts: new Date().toISOString(),
        pid: process.pid,
        cmd: "delegate",
        profile: opts.profile ?? null,
        provider: opts.provider ?? "cline-pass",
        model: opts.model ?? null,
        cwd: opts.cwd,
        timeoutSeconds: opts.timeoutSeconds,
        gitBranch: readGitBranch(opts.cwd),
      })}\n`,
    );
    const stdin = await readStdin();
    if (stdin.trim()) opts.stdin = stdin;
    const out = await delegate(opts, { run: runWithTimeout(opts.timeoutSeconds, runClineState) });
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
    if (opts.help) {
      process.stdout.write(
        "Usage: /cline:review [--base <ref>] [--model <id>] [--profile <name>] [--provider <id>] [--timeout <s>] [--cwd <path>] [--profiles-file <path>]\n",
      );
      process.exit(0);
    }
    if (!opts.cwd) opts.cwd = process.cwd();
    const runClineState = resolveClineState({ cwd: opts.cwd, invocationCwd });
    if (!runClineState.ok) {
      process.stdout.write(`${runClineState.text}\n`);
      process.exit(2);
    }
    const project = opts.profilesFile
      ? loadProfilesFileOrExit(opts.profilesFile)
      : findProjectProfiles(opts.cwd);
    applyProfileOrExit(opts, project);
    // Default timeout so a stuck Run can't block the session indefinitely
    // (cline's own default is 0 = no timeout). Override with --timeout.
    // Review is always plan mode (read-only), so use the longer default.
    if (opts.timeoutSeconds == null || Number.isNaN(opts.timeoutSeconds)) {
      opts.timeoutSeconds = DEFAULT_READONLY_TIMEOUT_S;
    }
    opts.runId = randomUUID().slice(0, 8);
    process.stdout.write(
      `cline-dispatch: ${JSON.stringify({
        runId: opts.runId,
        ts: new Date().toISOString(),
        pid: process.pid,
        cmd: "review",
        profile: opts.profile ?? null,
        provider: opts.provider ?? "cline-pass",
        model: opts.model ?? null,
        cwd: opts.cwd,
        timeoutSeconds: opts.timeoutSeconds,
        gitBranch: readGitBranch(opts.cwd),
      })}\n`,
    );
    opts.diff = await readStdin();
    const out = await review(opts, { run: runWithTimeout(opts.timeoutSeconds, runClineState) });
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
    if (!clineState.ok) {
      process.stdout.write(`${clineState.text}\n`);
      process.exit(2);
    }
    const auth = readStoredClineAuth(clineState);
    const nowIso = new Date().toISOString();
    const out = await usage(
      {
        token: auth.token,
        accountId: auth.accountId,
        authStatus: auth.status,
        authPath: auth.settingsPath,
        host: clineState.host,
        stateRoot: clineState.stateRoot,
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
            getCliVersion: () => getCliVersion(clineState),
            readAuth: () => readStoredClineAuth(clineState),
            getState: () => inspectClineState(clineState),
            loadModels: loadClinePassModels,
            loadProfiles,
            loadProjectProfiles: () => findProjectProfiles(process.cwd()),
            testRun: () => testClineRun(clineState),
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

  if (subcommand === "model-feed") {
    const args = rest.length === 1 ? tokenize(rest[0]) : rest;
    const stdin = await readStdin();
    const out = await handleModelFeed(args, { stdin, nowIso: new Date().toISOString() }, {
      fetchJson: realModelFeedFetchJson,
    });
    process.stdout.write(out.text + "\n");
    process.exit(out.ok ? 0 : 1);
  }

  process.stdout.write(`Unknown subcommand: ${subcommand ?? "(none)"}\n`);
  process.exit(2);
}

main().catch((error) => {
  process.stdout.write(`cline plugin command failed: ${error.message}\n`);
  process.exit(1);
});
