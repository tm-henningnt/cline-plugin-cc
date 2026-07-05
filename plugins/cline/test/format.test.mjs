import { test } from "node:test";
import assert from "node:assert/strict";
import { formatResult, isTransportCrash } from "../scripts/lib/format.mjs";

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
