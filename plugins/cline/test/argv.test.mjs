import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDelegateArgv, parseDelegateArgs, parseReviewArgs } from "../scripts/lib/argv.mjs";

test("buildDelegateArgv: defaults to json output and the ClinePass provider", () => {
  const argv = buildDelegateArgv({ prompt: "do a thing" });
  assert.ok(argv.includes("--json"), "always requests JSON");
  const p = argv.indexOf("-P");
  assert.equal(argv[p + 1], "cline-pass", "defaults provider to cline-pass (ClinePass)");
  assert.equal(argv.at(-1), "do a thing", "prompt is the trailing positional arg");
});

test("buildDelegateArgv: passes model, cwd and timeout when given", () => {
  const argv = buildDelegateArgv({
    prompt: "task",
    model: "poolside/laguna-xs-2.1",
    cwd: "/repo",
    timeoutSeconds: 120,
  });
  assert.equal(argv[argv.indexOf("-m") + 1], "poolside/laguna-xs-2.1");
  assert.equal(argv[argv.indexOf("-c") + 1], "/repo");
  assert.equal(argv[argv.indexOf("-t") + 1], "120");
});

test("buildDelegateArgv: no -m when model omitted (defer to cline config)", () => {
  const argv = buildDelegateArgv({ prompt: "task" });
  assert.ok(!argv.includes("-m"));
});

test("buildDelegateArgv: plan and read-only both enable plan mode (no writes)", () => {
  assert.ok(buildDelegateArgv({ prompt: "t", plan: true }).includes("-p"));
  assert.ok(buildDelegateArgv({ prompt: "t", readOnly: true }).includes("-p"));
  assert.ok(!buildDelegateArgv({ prompt: "t" }).includes("-p"), "normal delegate writes");
});

test("buildDelegateArgv: provider override", () => {
  const argv = buildDelegateArgv({ prompt: "t", provider: "anthropic" });
  assert.equal(argv[argv.indexOf("-P") + 1], "anthropic");
});

test("parseDelegateArgs: pulls known flags and keeps the rest as the prompt", () => {
  const opts = parseDelegateArgs(["--model", "x/y", "--timeout", "90", "add pagination to users"]);
  assert.equal(opts.model, "x/y");
  assert.equal(opts.timeoutSeconds, 90);
  assert.equal(opts.prompt, "add pagination to users");
});

test("parseDelegateArgs: parses profile from argv", () => {
  const opts = parseDelegateArgs(["--profile", "glm-5.2", "do the task"]);
  assert.equal(opts.profile, "glm-5.2");
  assert.equal(opts.prompt, "do the task");
});

test("parseDelegateArgs: boolean flags and a single quoted argument string", () => {
  const opts = parseDelegateArgs(['--plan --read-only "refactor the auth module"']);
  assert.equal(opts.plan, true);
  assert.equal(opts.readOnly, true);
  assert.equal(opts.prompt, "refactor the auth module");
});

test("parseDelegateArgs: parses profile from a raw argument string", () => {
  const opts = parseDelegateArgs('--profile glm-5.2 "do the task"');
  assert.equal(opts.profile, "glm-5.2");
  assert.equal(opts.prompt, "do the task");
});

test("parseDelegateArgs: prompt with flag-like words after the first non-flag is preserved", () => {
  const opts = parseDelegateArgs(["--model", "m", "explain --json output"]);
  assert.equal(opts.model, "m");
  assert.equal(opts.prompt, "explain --json output");
});

test("parseDelegateArgs: accepts a raw argument string, not just a pre-split array", () => {
  const opts = parseDelegateArgs('--plan "do the thing"');
  assert.equal(opts.plan, true);
  assert.equal(opts.prompt, "do the thing");
});

test("parseDelegateArgs: preserves multi-line prompt text from a raw string", () => {
  const opts = parseDelegateArgs(["--model x/y add a script that:\n- reads stdin\n- writes  hello.txt"]);
  assert.equal(opts.model, "x/y");
  assert.equal(opts.prompt, "add a script that:\n- reads stdin\n- writes  hello.txt");
});

test("parseDelegateArgs: preserves embedded quotes in a raw prompt", () => {
  const opts = parseDelegateArgs(['fix the "auth" bug']);
  assert.equal(opts.prompt, 'fix the "auth" bug');
});

test("parseDelegateArgs: strips one outer quote pair from a fully quoted raw prompt", () => {
  const opts = parseDelegateArgs(['"refactor the auth module"']);
  assert.equal(opts.prompt, "refactor the auth module");
});

test("parseDelegateArgs: value flags do not consume following boolean flags", () => {
  const opts = parseDelegateArgs(["--timeout --plan do the task"]);
  assert.equal(opts.plan, true);
  assert.ok(Number.isNaN(opts.timeoutSeconds));
  assert.equal(opts.prompt, "do the task");
});

test("parseDelegateArgs: profile does not consume a following boolean flag", () => {
  const opts = parseDelegateArgs(["--profile", "--plan", "task"]);
  assert.equal(opts.plan, true);
  assert.equal(opts.profile, undefined);
  assert.equal(opts.prompt, "task");
});

test("parseDelegateArgs: trailing value flag with no value does not crash", () => {
  const opts = parseDelegateArgs(["--model"]);
  assert.equal(Object.hasOwn(opts, "model"), true);
  assert.equal(opts.model, undefined);
  assert.equal(opts.prompt, "");
});

test("parseReviewArgs: pulls review flags from argv", () => {
  const opts = parseReviewArgs(["--base", "origin/main", "--model", "x/y"]);
  assert.deepEqual(opts, { base: "origin/main", model: "x/y" });
});

test("parseReviewArgs: parses profile from argv", () => {
  assert.deepEqual(parseReviewArgs(["--profile", "glm-5.2"]), { profile: "glm-5.2" });
});

test("parseReviewArgs: parses a single argument string", () => {
  const opts = parseReviewArgs("--base main --timeout 300");
  assert.equal(opts.base, "main");
  assert.equal(opts.timeoutSeconds, 300);
});

test("parseReviewArgs: ignores unknown tokens without collecting a prompt", () => {
  const opts = parseReviewArgs(["stray", "--base", "main"]);
  assert.equal(opts.base, "main");
  assert.equal(Object.hasOwn(opts, "prompt"), false);
});

test("parseReviewArgs: accepts cwd", () => {
  assert.deepEqual(parseReviewArgs(["--cwd", "/repo"]), { cwd: "/repo" });
});
