import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let stubDir;

const dispatcherPath = fileURLToPath(new URL("../scripts/dispatcher.mjs", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url));

before(() => {
  stubDir = mkdtempSync(join(tmpdir(), "cline-stub-"));
  const stubPath = join(stubDir, "cline");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node
// Test stub standing in for the real cline binary. Behavior is selected via
// the FAKE_CLINE_MODE env var. Never touches the network; this respects the
// repo rule that tests must not spawn a real cline process.
const mode = process.env.FAKE_CLINE_MODE ?? "success";
if (process.argv.includes("--version")) {
  console.log("3.0.37");
  process.exit(0);
}
async function writeSuccess() {
  let stdin = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) stdin += chunk;
  const { readFileSync, writeFileSync } = await import("node:fs");
  if (process.env.FAKE_CLINE_ARGV_PATH) {
    writeFileSync(process.env.FAKE_CLINE_ARGV_PATH, JSON.stringify(process.argv.slice(2)), "utf8");
  }
  if (process.env.FAKE_CLINE_STDIN_PATH) {
    writeFileSync(process.env.FAKE_CLINE_STDIN_PATH, stdin, "utf8");
  }
  process.stdout.write(readFileSync(process.env.FAKE_CLINE_FIXTURE, "utf8"));
}
function writeTransportCrash() {
  process.stderr.write("session not found\\n");
  process.exit(1);
}
if (mode === "exit-early") {
  process.stderr.write("auth expired\\n");
  process.exit(1);
}
if (mode === "transport-crash") {
  writeTransportCrash();
}
if (mode === "transport-crash-once") {
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const counterPath = process.env.FAKE_CLINE_COUNTER_PATH;
  const previous = counterPath && existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8")) : 0;
  const attempt = previous + 1;
  if (counterPath) writeFileSync(counterPath, String(attempt), "utf8");
  if (attempt === 1) writeTransportCrash();
  await writeSuccess();
  process.exit(0);
}
if (mode === "success") {
  await writeSuccess();
  process.exit(0);
}
process.stderr.write(\`unknown fake mode: \${mode}\\n\`);
process.exit(1);
`,
    "utf8",
  );
  chmodSync(stubPath, 0o755);
});

after(() => {
  if (stubDir) rmSync(stubDir, { recursive: true, force: true });
});

function runDispatcher(args, { input, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [dispatcherPath, ...args], {
      cwd,
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        FAKE_CLINE_MODE: "success",
        FAKE_CLINE_FIXTURE: fixturePath,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.on("error", () => {});
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

test("dispatcher: unknown subcommand exits with usage error", async () => {
  const out = await runDispatcher(["nonsense"]);

  assert.equal(out.code, 2);
  assert.match(out.stdout, /Unknown subcommand/);
});

test("dispatcher: delegate without a prompt exits with usage error", async () => {
  const out = await runDispatcher(["delegate"]);

  assert.equal(out.code, 2);
  assert.match(out.stdout, /No task given/);
});

test("dispatcher: delegate returns a successful Cline run summary", async () => {
  const out = await runDispatcher(["delegate", "make hello"]);

  assert.equal(out.code, 0);
  assert.match(out.stdout, /hello\.txt/);
});

test("dispatcher: delegate appends one ledger line when project ledger is enabled", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-ledger-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({ profiles: [], ledger: true }),
      "utf8",
    );

    const out = await runDispatcher(["delegate", "--cwd", projectDir, "make hello"]);

    assert.equal(out.code, 0);
    const ledgerPath = join(projectDir, ".cline-runs.ndjson");
    assert.equal(existsSync(ledgerPath), true);
    const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.cmd, "delegate");
    assert.equal(entry.ok, true);
    assert.equal(entry.model, "poolside/laguna-xs-2.1");
    assert.equal(entry.transport, null);
    assert.equal(entry.retried, false);
    assert.equal(entry.salvaged, false);
    assert.equal("prompt" in entry, false);
    assert.equal("summary" in entry, false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: delegate does not create a ledger when the switch is absent", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-no-ledger-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({ profiles: [] }),
      "utf8",
    );

    const out = await runDispatcher(["delegate", "--cwd", projectDir, "make hello"]);

    assert.equal(out.code, 0);
    assert.equal(existsSync(join(projectDir, ".cline-runs.ndjson")), false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: failed delegate after transport retries writes failure metadata to ledger", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-ledger-failure-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({ profiles: [], ledger: true }),
      "utf8",
    );

    const out = await runDispatcher(["delegate", "--cwd", projectDir, "make hello"], {
      env: { FAKE_CLINE_MODE: "transport-crash" },
    });

    assert.equal(out.code, 1);
    const lines = readFileSync(join(projectDir, ".cline-runs.ndjson"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.ok, false);
    assert.equal(entry.exitCode, 1);
    assert.equal(entry.retried, true);
    assert.equal(entry.salvaged, false);
    assert.equal(entry.transport, "session-not-found");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: ledger write failure does not change Run stdout or exit code", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-ledger-write-failure-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({ profiles: [], ledger: true }),
      "utf8",
    );
    mkdirSync(join(projectDir, ".cline-runs.ndjson"));

    const out = await runDispatcher(["delegate", "--cwd", projectDir, "make hello"]);

    assert.equal(out.code, 0);
    assert.match(out.stdout, /hello\.txt/);
    assert.doesNotMatch(out.stdout, /ledger write failed/);
    assert.match(out.stderr, /^\(cline ledger write failed: /);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: delegate retries one transport crash and returns a successful summary", async () => {
  const counterPath = join(stubDir, "transport-crash-once.count");
  const out = await runDispatcher(["delegate", "make hello"], {
    env: {
      FAKE_CLINE_MODE: "transport-crash-once",
      FAKE_CLINE_COUNTER_PATH: counterPath,
    },
  });

  assert.equal(out.code, 0);
  assert.equal(readFileSync(counterPath, "utf8"), "2");
  assert.match(out.stdout, /^Note: cline hit a transport error \(known signature\) and the Run was retried once\./);
  assert.match(out.stdout, /hello\.txt/);
  assert.match(out.stdout, /^cline-run: /m);
});

test("dispatcher: delegate reports failure after both transport attempts crash", async () => {
  const out = await runDispatcher(["delegate", "make hello"], {
    env: { FAKE_CLINE_MODE: "transport-crash" },
  });

  assert.equal(out.code, 1);
  assert.match(out.stdout, /^Note: cline hit a transport error \(known signature\) and the Run was retried once\./);
  assert.match(out.stdout, /\*\*Cline Run FAILED \(exit 1\)\*\*/);
  assert.match(out.stdout, /session not found/);
});

test("dispatcher: delegate forwards piped stdin to Cline", async () => {
  const stdinPath = join(stubDir, "delegate-stdin.txt");
  const input = "line one\nline two\n";
  const out = await runDispatcher(["delegate", "summarize the piped notes"], {
    input,
    env: { FAKE_CLINE_STDIN_PATH: stdinPath },
  });

  assert.equal(out.code, 0);
  assert.equal(readFileSync(stdinPath, "utf8"), input);
});

test("dispatcher: delegate profile resolves to the matching ClinePass model", async () => {
  const argvPath = join(stubDir, "delegate-profile-argv.json");
  const out = await runDispatcher(["delegate", "--profile", "glm-5.2", "say hi"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-P") + 1], "cline-pass");
  assert.equal(argv[argv.indexOf("-m") + 1], "cline-pass/glm-5.2");
});

test("dispatcher: bundled cline profile switches provider without forcing a model", async () => {
  const argvPath = join(stubDir, "delegate-cline-profile-argv.json");
  const out = await runDispatcher(["delegate", "--profile", "cline", "say hi"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-P") + 1], "cline");
  assert.equal(argv.includes("-m"), false);
});

test("dispatcher: project profile resolves from cwd", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({
        profiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
      }),
      "utf8",
    );
    const argvPath = join(stubDir, "delegate-project-profile-argv.json");
    const out = await runDispatcher(["delegate", "--profile", "quick", "--cwd", projectDir, "say hi"], {
      env: { FAKE_CLINE_ARGV_PATH: argvPath },
    });

    assert.equal(out.code, 0);
    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    assert.equal(argv[argv.indexOf("-P") + 1], "cline-pass");
    assert.equal(argv[argv.indexOf("-m") + 1], "cline-pass/deepseek-v4-flash");
    assert.doesNotMatch(out.stdout, /^Note:/m);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: project profiles are found by walking up from cwd", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({
        profiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
      }),
      "utf8",
    );
    const nestedDir = join(projectDir, "sub", "dir");
    mkdirSync(nestedDir, { recursive: true });
    const argvPath = join(stubDir, "delegate-project-profile-find-up-argv.json");
    const out = await runDispatcher(["delegate", "--profile", "quick", "--cwd", nestedDir, "say hi"], {
      env: { FAKE_CLINE_ARGV_PATH: argvPath },
    });

    assert.equal(out.code, 0);
    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    assert.equal(argv[argv.indexOf("-P") + 1], "cline-pass");
    assert.equal(argv[argv.indexOf("-m") + 1], "cline-pass/deepseek-v4-flash");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: project profile override can switch provider and prints spend notice", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({ profiles: [{ name: "glm-5.2", provider: "cline", model: null }] }),
      "utf8",
    );
    const argvPath = join(stubDir, "delegate-project-profile-override-argv.json");
    const out = await runDispatcher(["delegate", "--profile", "glm-5.2", "--cwd", projectDir, "say hi"], {
      env: { FAKE_CLINE_ARGV_PATH: argvPath },
    });

    assert.equal(out.code, 0);
    const argv = JSON.parse(readFileSync(argvPath, "utf8"));
    assert.equal(argv[argv.indexOf("-P") + 1], "cline");
    assert.equal(argv.includes("-m"), false);
    assert.match(
      out.stdout,
      /Note: profile "glm-5\.2" \(\.cline-profiles\.json\) targets provider "cline"/,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: malformed project profile file fails closed only when profile is used", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  try {
    writeFileSync(join(projectDir, ".cline-profiles.json"), "{not json", "utf8");
    const blockedArgvPath = join(stubDir, "delegate-malformed-profile-blocked-argv.json");
    const blocked = await runDispatcher(["delegate", "--profile", "quick", "--cwd", projectDir, "say hi"], {
      env: { FAKE_CLINE_ARGV_PATH: blockedArgvPath },
    });

    assert.equal(blocked.code, 2);
    assert.match(blocked.stdout, /Cannot use --profile: .*\.cline-profiles\.json is unreadable/);
    assert.equal(existsSync(blockedArgvPath), false);

    const allowedArgvPath = join(stubDir, "delegate-malformed-profile-ignored-argv.json");
    const allowed = await runDispatcher(["delegate", "--cwd", projectDir, "say hi"], {
      env: { FAKE_CLINE_ARGV_PATH: allowedArgvPath },
    });

    assert.equal(allowed.code, 0);
    assert.equal(existsSync(allowedArgvPath), true);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: profiles subcommand lists project and built-in profile sources", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "cline-project-empty-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({
        profiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
      }),
      "utf8",
    );

    const listed = await runDispatcher(["profiles", "--cwd", projectDir]);
    assert.equal(listed.code, 0);
    assert.match(listed.stdout, /Cline Profiles/);
    assert.match(listed.stdout, /`quick` → provider `cline-pass`.*— project/);
    assert.match(listed.stdout, /— ClinePass model/);
    assert.match(listed.stdout, /· fast iteration/);

    const missing = await runDispatcher(["profiles", "--cwd", emptyDir]);
    assert.equal(missing.code, 0);
    assert.match(missing.stdout, /no `\.cline-profiles\.json` found/);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("dispatcher: unknown profile lists project names", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "cline-project-"));
  try {
    writeFileSync(
      join(projectDir, ".cline-profiles.json"),
      JSON.stringify({
        profiles: [{ name: "quick", provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" }],
      }),
      "utf8",
    );
    const argvPath = join(stubDir, "delegate-unknown-project-profile-argv.json");
    const out = await runDispatcher(["delegate", "--profile", "nope", "--cwd", projectDir, "hi"], {
      env: { FAKE_CLINE_ARGV_PATH: argvPath },
    });

    assert.equal(out.code, 2);
    assert.match(out.stdout, /Unknown profile "nope"/);
    assert.match(out.stdout, /quick/);
    assert.equal(existsSync(argvPath), false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("dispatcher: unknown delegate profile exits before spawning Cline", async () => {
  const argvPath = join(stubDir, "delegate-unknown-profile-argv.json");
  const out = await runDispatcher(["delegate", "--profile", "not-a-real-model", "say hi"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 2);
  assert.match(out.stdout, /Unknown profile "not-a-real-model"/);
  assert.match(out.stdout, /glm-5\.2/);
  assert.equal(existsSync(argvPath), false);
});

test("dispatcher: conflicting delegate profile and model exits before spawning Cline", async () => {
  const argvPath = join(stubDir, "delegate-conflicting-profile-argv.json");
  const out = await runDispatcher(
    ["delegate", "--profile", "glm-5.2", "--model", "cline-pass/kimi-k2.6", "say hi"],
    { env: { FAKE_CLINE_ARGV_PATH: argvPath } },
  );

  assert.equal(out.code, 2);
  assert.match(out.stdout, /Use either --profile or --model\/--provider, not both/);
  assert.equal(existsSync(argvPath), false);
});

test("dispatcher: conflicting delegate profile and provider exits before spawning Cline", async () => {
  const argvPath = join(stubDir, "delegate-conflicting-profile-provider-argv.json");
  const out = await runDispatcher(
    ["delegate", "--profile", "glm-5.2", "--provider", "cline", "say hi"],
    { env: { FAKE_CLINE_ARGV_PATH: argvPath } },
  );

  assert.equal(out.code, 2);
  assert.match(out.stdout, /Use either --profile or --model\/--provider, not both/);
  assert.equal(existsSync(argvPath), false);
});

test("dispatcher: review profile switches provider without forcing a model", async () => {
  const argvPath = join(stubDir, "review-cline-profile-argv.json");
  const out = await runDispatcher(["review", "--profile", "cline"], {
    input: "diff --git a/x b/x\n",
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-P") + 1], "cline");
  assert.equal(argv.includes("-p"), true);
  assert.equal(argv.includes("-m"), false);
});

test("dispatcher: review reports early Cline exit without crashing on EPIPE", async () => {
  const out = await runDispatcher(["review"], {
    input: "x".repeat(8 * 1024 * 1024),
    env: { FAKE_CLINE_MODE: "exit-early" },
  });

  assert.equal(out.code, 1);
  assert.match(out.stdout, /\*\*Cline Run FAILED \(exit 1\)\*\*/);
  assert.doesNotMatch(out.stderr, /EPIPE/);
});

test("dispatcher: review with empty input returns without calling Cline", async () => {
  const out = await runDispatcher(["review"], { input: "" });

  assert.equal(out.code, 0);
  assert.equal(out.stdout, "No changes to review.\n");
});

test("dispatcher: delegate writing default timeout is 600", async () => {
  const argvPath = join(stubDir, "delegate-default-timeout-argv.json");
  const out = await runDispatcher(["delegate", "do a thing"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-t") + 1], "600");
});

test("dispatcher: delegate --plan default timeout is 1800", async () => {
  const argvPath = join(stubDir, "delegate-plan-timeout-argv.json");
  const out = await runDispatcher(["delegate", "--plan", "audit the codebase"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-t") + 1], "1800");
});

test("dispatcher: review default timeout is 1800", async () => {
  const argvPath = join(stubDir, "review-timeout-argv.json");
  const out = await runDispatcher(["review"], {
    input: "diff --git a/x b/x\n",
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-t") + 1], "1800");
});

test("dispatcher: explicit --timeout overrides default for --plan", async () => {
  const argvPath = join(stubDir, "delegate-explicit-timeout-argv.json");
  const out = await runDispatcher(["delegate", "--plan", "--timeout", "90", "quick check"], {
    env: { FAKE_CLINE_ARGV_PATH: argvPath },
  });

  assert.equal(out.code, 0);
  const argv = JSON.parse(readFileSync(argvPath, "utf8"));
  assert.equal(argv[argv.indexOf("-t") + 1], "90");
});
