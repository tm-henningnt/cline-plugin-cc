import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatResult,
  isTransportCrash,
  isTransportRetryable,
  transportSignature,
  formatRunFailure,
  buildFailureTelemetry,
} from "../scripts/lib/format.mjs";

function parseTrailer(text) {
  const line = text.split("\n").find((candidate) => candidate.startsWith("cline-run: "));
  assert.ok(line, "expected cline-run trailer");
  return JSON.parse(line.slice("cline-run: ".length));
}

test("formatResult: a failed extraction reports the error verbatim", () => {
  const text = formatResult({ error: "no run_result event found in cline output" });
  assert.equal(text, "Cline run did not complete: no run_result event found in cline output");
});

test("formatResult: a non-completed finishReason is surfaced with the summary", () => {
  const text = formatResult({ finishReason: "error", summary: "hit the retry limit" });
  const [firstLine] = text.split("\n");
  assert.equal(firstLine, "**Cline Run finished (error)**");
  assert.match(text, /hit the retry limit/);
});

test("formatResult: a missing finishReason falls back to unknown with no summary/meta lines", () => {
  const text = formatResult({ finishReason: undefined });
  assert.equal(text, "**Cline Run finished (unknown)**");
});

test("formatResult: a completed run includes model, tool calls, cost and duration in the meta line", () => {
  const text = formatResult({
    finishReason: "completed",
    summary: "done",
    model: "m",
    toolCalls: 2,
    usage: { totalCost: 0.5 },
    durationMs: 1500,
  });
  assert.match(text, /model: m/);
  assert.match(text, /tool calls: 2/);
  assert.match(text, /cost: \$0\.500000/);
  assert.match(text, /1\.5s/);
});

test("formatResult: a completed run includes a parseable cline-run telemetry trailer", () => {
  const text = formatResult({
    finishReason: "completed",
    summary: "done",
    model: "m",
    provider: "p",
    toolCalls: 2,
    usage: { totalCost: "0.5" },
    durationMs: "1500",
  });
  const lines = text.split("\n");

  assert.equal(lines.at(-2), "_model: m · tool calls: 2 · cost: $0.500000 · 1.5s_");
  assert.deepEqual(parseTrailer(text), {
    model: "m",
    provider: "p",
    costUsd: 0.5,
    durationMs: 1500,
    toolCalls: 2,
    finishReason: "completed",
  });
});

test("formatResult: telemetry trailer includes true retry and salvage annotations", () => {
  const text = formatResult(
    {
      finishReason: "completed",
      summary: "done",
      model: "m",
      usage: {},
    },
    { retried: true, salvaged: true },
  );

  const parsed = parseTrailer(text);
  assert.equal(parsed.retried, true);
  assert.equal(parsed.salvaged, true);
});

test("formatResult: telemetry trailer omits retry and salvage keys without annotations", () => {
  const text = formatResult({
    finishReason: "completed",
    summary: "done",
    model: "m",
    usage: {},
  });

  const parsed = parseTrailer(text);
  assert.equal("retried" in parsed, false);
  assert.equal("salvaged" in parsed, false);
});

test("formatResult: a string-valued cost is coerced and rendered", () => {
  const text = formatResult({
    finishReason: "completed",
    usage: { totalCost: "0.25" },
  });
  assert.match(text, /cost: \$0\.250000/);
});

test("formatResult: a non-numeric cost is omitted rather than shown as zero", () => {
  const text = formatResult({
    finishReason: "completed",
    usage: { totalCost: "not-a-number" },
  });
  assert.doesNotMatch(text, /cost:/);
});

test("formatResult: malformed line count is surfaced when present", () => {
  const text = formatResult({ finishReason: "completed", malformedLines: 2 });
  assert.match(text, /2 unparseable output lines skipped/);
});

test("formatResult: no malformed line note when malformedLines is 0", () => {
  const text = formatResult({ finishReason: "completed", malformedLines: 0 });
  assert.doesNotMatch(text, /unparseable output lines skipped/);
});

test("formatResult: only reports the meta fields that are present", () => {
  const text = formatResult({ finishReason: "completed", model: "m" });
  const lines = text.split("\n");
  const metaLine = lines.at(-2);
  assert.equal(metaLine, "_model: m_");
  assert.equal(lines.at(-1), 'cline-run: {"model":"m","finishReason":"completed"}');
});

test("formatResult: no prose meta line when only the finish reason is set", () => {
  const text = formatResult({ finishReason: "completed" });
  assert.equal(text, '**Cline Run completed**\ncline-run: {"finishReason":"completed"}');
});

test("isTransportCrash: ignores signatures inside run_result model content", () => {
  assert.equal(
    isTransportCrash(
      1,
      '{"type":"run_result","finishReason":"aborted","text":"the fix handles the session not found case"}',
      "",
    ),
    false,
  );
});

test("isTransportCrash: scans structured error lines", () => {
  assert.equal(
    isTransportCrash(
      1,
      '{"ts":"2026-07-04T21:56:25.591Z","type":"error","message":"session not found: 1783201582846_p885q"}',
      "",
    ),
    true,
  );
});

test("isTransportCrash: scans plain stderr", () => {
  assert.equal(isTransportCrash(1, "", "session not found"), true);
});

test("isTransportCrash: exit 0 is never a crash", () => {
  assert.equal(isTransportCrash(0, "session not found", "session not found"), false);
});

test("transportSignature: classifies timeout error on stderr", () => {
  assert.equal(transportSignature(1, "", "{\"message\":\"run timed out after 5s\"}"), "timeout");
});

test("transportSignature: classifies ClinePass quota 429 as non-retryable rate-limit", () => {
  const stderr =
    "Error 429: You have reached your weekly Clinepass limit. The limit resets in 4d 8h";

  assert.equal(transportSignature(1, "", stderr), "rate-limit");
  assert.equal(isTransportRetryable(1, "", stderr), false);
});

test("transportSignature: rate-limit wins over hook dispatch envelopes", () => {
  const stderr =
    "Error 429: You have reached your weekly Clinepass limit. hook dispatch failed";

  assert.equal(transportSignature(1, "", stderr), "rate-limit");
  assert.equal(isTransportRetryable(1, "", stderr), false);
});

test("transportSignature: existing transport signatures keep retry behavior", () => {
  assert.equal(transportSignature(1, "", "hook dispatch failed"), "hook-dispatch-failed");
  assert.equal(isTransportRetryable(1, "", "hook dispatch failed"), true);
  assert.equal(transportSignature(1, "", "session not found"), "session-not-found");
  assert.equal(isTransportRetryable(1, "", "session not found"), true);
  assert.equal(transportSignature(1, "", "run timed out after 5s"), "timeout");
  assert.equal(isTransportRetryable(1, "", "run timed out after 5s"), false);
});

test("transportSignature: hook-dispatch-failed wins over timeout when combined", () => {
  // Real crash: hook dispatch failed line followed by "The operation timed out."
  // timeout is last in the table, so hook-dispatch-failed wins.
  assert.equal(
    transportSignature(
      1,
      '{"ts":"...","type":"error","message":"hook dispatch failed: session.hook requires a valid hook event payload"}',
      "The operation timed out.",
    ),
    "hook-dispatch-failed",
  );
});

test("transportSignature: timeout text on stderr classified even with empty stdout", () => {
  assert.equal(transportSignature(1, "", "run timed out after 600s"), "timeout");
});

test("transportSignature: exit 0 returns null regardless of text", () => {
  assert.equal(transportSignature(0, "run timed out after 5s", "run timed out after 5s"), null);
});

test("isTransportRetryable: timeout is not retryable", () => {
  assert.equal(isTransportRetryable(1, "", "run timed out after 5s"), false);
});

test("isTransportRetryable: session-not-found is retryable", () => {
  assert.equal(isTransportRetryable(1, "", "session not found"), true);
});

test("isTransportRetryable: exit 0 returns false", () => {
  assert.equal(isTransportRetryable(0, "run timed out after 5s", ""), false);
});

test("formatRunFailure: first line is bold FAILED with exit code", () => {
  const text = formatRunFailure(2, "", "auth expired");
  assert.match(text, /^\*\*Cline Run FAILED \(exit 2\)\*\*/);
  assert.match(text, /auth expired/);
});

test("formatRunFailure: includes failure trailer as last line", () => {
  const text = formatRunFailure(2, "", "auth expired");
  const lastLine = text.split("\n").at(-1);
  assert.match(lastLine, /^cline-run: /);
  const parsed = JSON.parse(lastLine.slice("cline-run: ".length));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 2);
});

test("formatRunFailure: timeout with toolCalls includes diff hint", () => {
  const text = formatRunFailure(1, "", "run timed out after 5s", {
    transport: "timeout",
    toolCalls: 17,
  });
  assert.match(text, /The Run timed out during or after doing real work \(17 tool calls recorded\)/);
  assert.match(text, /git diff/);
});

test("formatRunFailure: timeout with zero toolCalls omits diff hint", () => {
  const text = formatRunFailure(1, "", "run timed out after 5s", {
    transport: "timeout",
    toolCalls: 0,
  });
  assert.doesNotMatch(text, /git diff/);
});

test("formatRunFailure: failure trailer carries toolCalls when annotations carry a count", () => {
  const text = formatRunFailure(1, "", "run timed out after 5s", {
    transport: "timeout",
    toolCalls: 17,
  });
  const lastLine = text.split("\n").at(-1);
  assert.match(lastLine, /^cline-run: /);
  const parsed = JSON.parse(lastLine.slice("cline-run: ".length));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.transport, "timeout");
  assert.equal(parsed.toolCalls, 17);
});

test("formatRunFailure: failure trailer omits toolCalls when annotations carry no count", () => {
  const text = formatRunFailure(2, "", "auth expired", {
    transport: "session-not-found",
  });
  const lastLine = text.split("\n").at(-1);
  const parsed = JSON.parse(lastLine.slice("cline-run: ".length));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 2);
  assert.equal(parsed.transport, "session-not-found");
  assert.equal("toolCalls" in parsed, false);
});

test("formatRunFailure: failure trailer carries transport and retried when given", () => {
  const text = formatRunFailure(1, "", "session not found", {
    transport: "session-not-found",
    retried: true,
    toolCalls: 0,
  });
  const lastLine = text.split("\n").at(-1);
  const parsed = JSON.parse(lastLine.slice("cline-run: ".length));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.transport, "session-not-found");
  assert.equal(parsed.retried, true);
});

test("buildFailureTelemetry: includes ok, exitCode, transport and toolCalls from annotations", () => {
  const telemetry = buildFailureTelemetry(1, { transport: "timeout", retried: false, toolCalls: 5 });
  assert.deepEqual(telemetry, { ok: false, exitCode: 1, transport: "timeout", toolCalls: 5 });
});

test("buildFailureTelemetry: omits transport when absent", () => {
  const telemetry = buildFailureTelemetry(2, { toolCalls: 3 });
  assert.deepEqual(telemetry, { ok: false, exitCode: 2, toolCalls: 3 });
});

test("buildFailureTelemetry: omits toolCalls when annotations carry no count", () => {
  assert.equal("toolCalls" in buildFailureTelemetry(1, {}), false);
});

test("formatResult: success trailer includes inputTokens and outputTokens when present", () => {
  const text = formatResult({
    finishReason: "completed",
    summary: "done",
    model: "m",
    usage: { inputTokens: 12000, outputTokens: 450 },
  });
  const parsed = parseTrailer(text);
  assert.equal(parsed.inputTokens, 12000);
  assert.equal(parsed.outputTokens, 450);
});

test("formatResult: success trailer omits token fields when absent", () => {
  const text = formatResult({
    finishReason: "completed",
    summary: "done",
    model: "m",
    usage: { totalCost: 0.1 },
  });
  const parsed = parseTrailer(text);
  assert.equal("inputTokens" in parsed, false);
  assert.equal("outputTokens" in parsed, false);
});
