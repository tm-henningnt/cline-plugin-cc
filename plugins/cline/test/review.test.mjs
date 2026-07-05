import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { review } from "../scripts/lib/review.mjs";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url)),
  "utf8",
);

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

test("review: a successful run uses plan mode and returns the findings", async () => {
  const diff = "diff --git a/hello.txt b/hello.txt\n+hello\n";
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "", exitCode: 0 });
  const out = await review(
    {
      diff,
      cwd: "/repo",
      provider: "cline",
      model: "poolside/laguna-xs-2.1",
      timeoutSeconds: 600,
    },
    { run },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /hello\.txt/);
  assert.ok(calls[0].argv.includes("-p"), "review always runs in plan mode");
  assert.equal(calls[0].opts.cwd, "/repo");
  assert.equal(calls[0].opts.input, diff);
});

test("review: an empty diff returns without calling Cline", async () => {
  let called = false;
  const out = await review(
    { diff: " \n\t" },
    {
      run: async () => {
        called = true;
      },
    },
  );

  assert.equal(out.ok, true);
  assert.equal(out.text, "No changes to review.");
  assert.equal(called, false);
});

test("review: a non-zero exit is reported, not swallowed", async () => {
  const { run } = fakeRun({ stdout: "", stderr: "auth expired", exitCode: 2 });
  const out = await review({ diff: "+broken\n" }, { run });

  assert.equal(out.ok, false);
  assert.match(out.text, /exited with code 2/);
  assert.match(out.text, /auth expired/);
});

test("review: salvages a completed run from non-zero exit output", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "", exitCode: 1 });
  const out = await review({ diff: "+changed\n" }, { run });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.match(out.text, /^Warning: cline exited with code 1/);
  assert.match(out.text, /hello\.txt/);
  assert.match(out.text, /_model: poolside\/laguna-xs-2\.1 · tool calls: 1 · cost: \$0\.000796 · 4\.2s_/);
  assert.match(out.text, /^cline-run: /m);
  assert.equal(out.runMeta.exitCode, 1);
  assert.equal(out.runMeta.salvaged, true);
});

test("review: first-attempt salvage trailer includes salvaged annotation only", async () => {
  const { run } = fakeRun({ stdout: fixture, stderr: "", exitCode: 1 });
  const out = await review({ diff: "+changed\n" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal(parsed.salvaged, true);
  assert.equal("retried" in parsed, false);
});

test("review: retries a known transport crash once and returns the second success", async () => {
  const diff = "+changed\n";
  const { run, calls } = fakeRunSequence([
    { stdout: "", stderr: "hook dispatch failed: session.hook requires a valid hook event payload", exitCode: 1 },
    { stdout: fixture, stderr: "", exitCode: 0 },
  ]);
  const out = await review({ diff, cwd: "/repo" }, { run });

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
    transport: "hook-dispatch-failed",
  });
});

test("review: retry trailer includes retried annotation only", async () => {
  const { run } = fakeRunSequence([
    { stdout: "", stderr: "hook dispatch failed: session.hook requires a valid hook event payload", exitCode: 1 },
    { stdout: fixture, stderr: "", exitCode: 0 },
  ]);
  const out = await review({ diff: "+changed\n" }, { run });

  const trailer = out.text
    .split("\n")
    .filter((line) => line.startsWith("cline-run: "))
    .at(-1);
  const parsed = JSON.parse(trailer.slice("cline-run: ".length));
  assert.equal(parsed.retried, true);
  assert.equal("salvaged" in parsed, false);
});

test("review: reports the second transport crash after one retry", async () => {
  const { run, calls } = fakeRunSequence([
    { stdout: "", stderr: "hook dispatch failed: session.hook requires a valid hook event payload", exitCode: 1 },
    { stdout: "", stderr: "hook dispatch failed: session.hook requires a valid hook event payload", exitCode: 1 },
  ]);
  const out = await review({ diff: "+changed\n" }, { run });

  assert.equal(out.ok, false);
  assert.equal(calls.length, 2);
  assert.match(out.text, /^Note: cline hit a transport error \(known signature\) and the Run was retried once\./);
  assert.match(out.text, /Cline exited with code 1/);
  assert.match(out.text, /hook dispatch failed/);
});

test("review: non-transport failures are not retried", async () => {
  const { run, calls } = fakeRun({ stdout: "", stderr: "auth expired", exitCode: 1 });
  const out = await review({ diff: "+changed\n" }, { run });

  assert.equal(out.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(out.text, "Cline exited with code 1.\nauth expired");
});

test("review: transport signatures do not retry when completed output is salvageable", async () => {
  const { run, calls } = fakeRun({ stdout: fixture, stderr: "session not found", exitCode: 1 });
  const out = await review({ diff: "+changed\n" }, { run });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.match(out.text, /^Warning: cline exited with code 1/);
  assert.doesNotMatch(out.text, /^Note: cline hit a transport error/m);
});
