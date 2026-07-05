import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { delegate } from "../scripts/lib/delegate.mjs";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url)),
  "utf8",
);

// A fake runner records how it was invoked and returns canned output.
function fakeRun(result) {
  const calls = [];
  const run = async (argv, opts) => {
    calls.push({ argv, opts });
    return result;
  };
  return { run, calls };
}

function fakeRunSequence(results) {
  const calls = [];
  const run = async (argv, opts) => {
    calls.push({ argv, opts });
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  return { run, calls };
}

test("delegate: a successful run returns the summary and marks ok", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "", exitCode: 0 });
  const out = await delegate({ prompt: "make hello.txt", cwd: "/repo" }, { run });

  assert.equal(out.ok, true);
  assert.match(out.text, /hello\.txt/);
  // the seam received the built argv, including --json and the prompt
  assert.ok(calls[0].argv.includes("--json"));
  assert.equal(calls[0].argv.at(-1), "make hello.txt");
  assert.equal(calls[0].opts.cwd, "/repo");
});

test("delegate: plain success trailer omits retry and salvage annotations", async () => {
  const { run } = fakeRun({ stdout: fixture, stderr: "", exitCode: 0 });
  const out = await delegate({ prompt: "task" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal("retried" in parsed, false);
  assert.equal("salvaged" in parsed, false);
});

test("delegate: a non-zero exit is reported, not swallowed", async () => {
  const { run } = fakeRun({ stdout: "", stderr: "auth expired", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });
  assert.equal(out.ok, false);
  assert.match(out.text, /exited with code 1/);
  assert.match(out.text, /auth expired/);
});

test("delegate: salvages a completed run from non-zero exit output", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.match(out.text, /^Warning: cline exited with code 1/);
  assert.match(out.text, /hello\.txt/);
  assert.match(out.text, /_model: poolside\/laguna-xs-2\.1 · tool calls: 1 · cost: \$0\.000796 · 4\.2s_/);
  assert.match(out.text, /^cline-run: /m);
  assert.equal(out.runMeta.exitCode, 1);
  assert.equal(out.runMeta.salvaged, true);
});

test("delegate: first-attempt salvage trailer includes salvaged annotation only", async () => {
  const { run } = fakeRun({ stdout: fixture, stderr: "", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal(parsed.salvaged, true);
  assert.equal("retried" in parsed, false);
});

test("delegate: retries a known transport crash once and returns the second success", async () => {
  const { run, calls } = fakeRunSequence([
    { stdout: "", stderr: "session not found", exitCode: 1 },
    { stdout: fixture, stderr: "", exitCode: 0 },
  ]);
  const out = await delegate({ prompt: "task", cwd: "/repo", stdin: "context" }, { run });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.match(out.text, /^Note: cline hit a transport error \(known signature\) and the Run was retried once\./);
  assert.match(out.text, /hello\.txt/);
  assert.match(out.text, /^cline-run: /m);
  assert.deepEqual(out.runMeta, {
    exitCode: 0,
    retried: true,
    salvaged: false,
    transport: "session-not-found",
  });
});

test("delegate: retry trailer includes retried annotation only", async () => {
  const { run } = fakeRunSequence([
    { stdout: "", stderr: "session not found", exitCode: 1 },
    { stdout: fixture, stderr: "", exitCode: 0 },
  ]);
  const out = await delegate({ prompt: "task" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal(parsed.retried, true);
  assert.equal("salvaged" in parsed, false);
});

test("delegate: transport crash then salvage trailer includes retried and salvaged annotations", async () => {
  const { run } = fakeRunSequence([
    { stdout: "", stderr: "session not found", exitCode: 1 },
    { stdout: fixture, stderr: "", exitCode: 1 },
  ]);
  const out = await delegate({ prompt: "task" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal(parsed.retried, true);
  assert.equal(parsed.salvaged, true);
});

test("delegate: reports the second transport crash after one retry", async () => {
  const { run, calls } = fakeRunSequence([
    { stdout: "", stderr: "session not found", exitCode: 1 },
    { stdout: "", stderr: "session not found", exitCode: 1 },
  ]);
  const out = await delegate({ prompt: "task" }, { run });

  assert.equal(out.ok, false);
  assert.equal(calls.length, 2);
  assert.match(out.text, /^Note: cline hit a transport error \(known signature\) and the Run was retried once\./);
  assert.match(out.text, /Cline exited with code 1/);
  assert.match(out.text, /session not found/);
});

test("delegate: non-transport failures are not retried", async () => {
  const { run, calls } = fakeRun({ stdout: "", stderr: "auth expired", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });

  assert.equal(out.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(out.text, "Cline exited with code 1.\nauth expired");
});

test("delegate: transport signatures do not retry when completed output is salvageable", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "session not found", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.match(out.text, /^Warning: cline exited with code 1/);
  assert.doesNotMatch(out.text, /^Note: cline hit a transport error/m);
});

test("delegate: model-authored transport text in an aborted result does not retry", async () => {
  const stdout =
    '{"type":"run_result","finishReason":"aborted","text":"the summary mentions session not found"}';
  const { run, calls } = fakeRun({ stdout, stderr: "", exitCode: 1 });
  const out = await delegate({ prompt: "task" }, { run });

  assert.equal(out.ok, false);
  assert.equal(calls.length, 1);
});

test("delegate: exit 0 but no run_result is reported as incomplete", async () => {
  const { run } = fakeRun({
    stdout: '{"type":"hook_event","hookEventName":"agent_start"}',
    stderr: "",
    exitCode: 0,
  });
  const out = await delegate({ prompt: "task" }, { run });
  assert.equal(out.ok, false);
  assert.match(out.text, /run_result|did not complete/i);
});

test("delegate: a non-zero exit with empty stderr falls back to stdout for the detail", async () => {
  const { run } = fakeRun({ stdout: "boom from stdout", stderr: "", exitCode: 3 });
  const out = await delegate({ prompt: "task" }, { run });
  assert.equal(out.ok, false);
  assert.match(out.text, /exited with code 3/);
  assert.match(out.text, /boom from stdout/);
});

test("delegate: stdin context is forwarded to the runner", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "", exitCode: 0 });
  await delegate({ prompt: "review", stdin: "some diff" }, { run });
  assert.equal(calls[0].opts.input, "some diff");
});
