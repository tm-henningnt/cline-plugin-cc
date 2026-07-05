import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractResult, parseNdjson } from "../scripts/lib/parse-ndjson.mjs";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url)),
  "utf8",
);

test("extractResult: reads summary, status, cost and model from the run_result line", () => {
  const r = extractResult(fixture);
  assert.equal(r.ok, true);
  assert.equal(r.finishReason, "completed");
  assert.match(r.summary, /hello\.txt/);
  assert.equal(r.model, "poolside/laguna-xs-2.1");
  assert.equal(r.provider, "cline");
  assert.equal(r.usage.totalCost, 0.00079584);
  assert.equal(r.usage.inputTokens, 18832);
});

test("extractResult: counts tool_call hook events as tool activity", () => {
  const r = extractResult(fixture);
  assert.equal(r.toolCalls, 1);
});

test("parseNdjson: tolerates a malformed line and records it", () => {
  const withGarbage = fixture + "\nthis is not json\n";
  const { events, malformed } = parseNdjson(withGarbage);
  assert.ok(events.length >= 1);
  assert.equal(malformed.length, 1);
});

test("extractResult: no run_result present is an error, not a throw", () => {
  const onlyHooks =
    '{"type":"hook_event","hookEventName":"agent_start"}\n{"type":"agent_event","event":{"type":"iteration_start"}}';
  const r = extractResult(onlyHooks);
  assert.equal(r.ok, false);
  assert.match(r.error, /run_result/);
});

test("extractResult: a non-completed finishReason is surfaced as not-ok", () => {
  const errored =
    '{"type":"run_result","finishReason":"error","text":"hit the retry limit","usage":{}}';
  const r = extractResult(errored);
  assert.equal(r.ok, false);
  assert.equal(r.finishReason, "error");
  assert.match(r.summary, /retry limit/);
});
