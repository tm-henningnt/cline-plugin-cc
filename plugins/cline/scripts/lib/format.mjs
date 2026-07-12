// Pure rendering of an extracted Result into the markdown the command relays.

const TRANSPORT_SIGNATURES = [
  {
    key: "rate-limit",
    pattern: /\b429\b|reached your (weekly |monthly |daily )?clinepass limit|rate.?limit/i,
    retryable: false,
  },
  { key: "session-not-found", pattern: /session not found/i, retryable: true },
  { key: "hook-dispatch-failed", pattern: /hook dispatch failed/i, retryable: true },
  { key: "stalled", pattern: /stall watchdog/i, retryable: false },
  { key: "timeout", pattern: /timed out/i, retryable: false },
];
const MODEL_CONTENT_TYPES = new Set(["run_result", "agent_event", "hook_event"]);

function scannableCrashText(stdout, stderr) {
  const kept = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && MODEL_CONTENT_TYPES.has(obj.type)) continue;
      kept.push(JSON.stringify(obj));
    } catch {
      kept.push(trimmed);
    }
  }
  kept.push(String(stderr ?? ""));
  return kept.join("\n");
}

export function isTransportCrash(exitCode, stdout, stderr) {
  return transportSignature(exitCode, stdout, stderr) != null;
}

// Returns a short stable key for the matched transport signature, or null.
export function transportSignature(exitCode, stdout, stderr) {
  if (exitCode === 0) return null;
  const text = scannableCrashText(stdout, stderr);
  return TRANSPORT_SIGNATURES.find((signature) => signature.pattern.test(text))?.key ?? null;
}

// Returns whether the matched transport signature is retryable.
export function isTransportRetryable(exitCode, stdout, stderr) {
  if (exitCode === 0) return false;
  const text = scannableCrashText(stdout, stderr);
  return TRANSPORT_SIGNATURES.find((signature) => signature.pattern.test(text))?.retryable ?? false;
}

// One rendering for "the cline subprocess failed" across delegate/review/setup.
export function formatRunFailure(exitCode, stdout, stderr, failureMeta = {}) {
  const detail = String(stderr || stdout || "")
    .trim()
    .split("\n")
    .slice(-5)
    .join("\n");
  const lines = [`**Cline Run FAILED (exit ${exitCode})**`];

  if (detail) lines.push("", detail);

  if (failureMeta.transport === "timeout" && failureMeta.toolCalls > 0) {
    lines.push(
      "",
      `The Run timed out during or after doing real work (${failureMeta.toolCalls} tool calls recorded) — the working tree may contain a partial or complete diff. Review \`git diff\` before retrying or escalating.`,
    );
  }

  const telemetry = buildFailureTelemetry(exitCode, failureMeta);
  lines.push(`cline-run: ${JSON.stringify(telemetry)}`);

  return lines.join("\n");
}

export function formatUsd(value) {
  const n = Number(value);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(6)}`;
}

function finiteNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildRunTelemetry(result, annotations) {
  const telemetry = {};
  if (result.model != null) telemetry.model = result.model;
  if (result.provider != null) telemetry.provider = result.provider;

  const costUsd = finiteNumber(result.usage?.totalCost);
  if (costUsd != null) telemetry.costUsd = costUsd;

  const durationMs = finiteNumber(result.durationMs);
  if (durationMs != null) telemetry.durationMs = durationMs;

  const toolCalls = finiteNumber(result.toolCalls);
  if (toolCalls != null) telemetry.toolCalls = toolCalls;

  const inputTokens = finiteNumber(result.usage?.inputTokens);
  if (inputTokens != null) telemetry.inputTokens = inputTokens;

  const outputTokens = finiteNumber(result.usage?.outputTokens);
  if (outputTokens != null) telemetry.outputTokens = outputTokens;

  if (result.finishReason != null) telemetry.finishReason = result.finishReason;
  if (annotations.retried) telemetry.retried = true;
  if (annotations.salvaged) telemetry.salvaged = true;
  if (annotations.runId) telemetry.runId = annotations.runId;
  return telemetry;
}

export function buildFailureTelemetry(exitCode, annotations) {
  const telemetry = { ok: false, exitCode };
  if (annotations.transport) telemetry.transport = annotations.transport;
  if (annotations.retried) telemetry.retried = true;
  if (annotations.runId) telemetry.runId = annotations.runId;
  const tc = finiteNumber(annotations?.toolCalls);
  if (tc != null) telemetry.toolCalls = tc;
  return telemetry;
}

export function formatResult(result, annotations = {}) {
  if (result.error) {
    return `Cline run did not complete: ${result.error}`;
  }

  const status =
    result.finishReason === "completed"
      ? "completed"
      : `finished (${result.finishReason ?? "unknown"})`;
  const lines = [`**Cline Run ${status}**`];

  if (result.summary) lines.push("", result.summary);

  const meta = [];
  if (result.model) meta.push(`model: ${result.model}`);
  if (result.toolCalls != null) meta.push(`tool calls: ${result.toolCalls}`);
  const cost = Number(result.usage?.totalCost);
  if (result.usage?.totalCost != null && Number.isFinite(cost)) meta.push(`cost: ${formatUsd(cost)}`);
  const durationMs = Number(result.durationMs);
  if (result.durationMs != null && Number.isFinite(durationMs)) meta.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (result.malformedLines > 0) meta.push(`${result.malformedLines} unparseable output lines skipped`);
  if (meta.length) lines.push("", `_${meta.join(" · ")}_`);

  const telemetry = buildRunTelemetry(result, annotations);
  if (Object.keys(telemetry).length) lines.push(`cline-run: ${JSON.stringify(telemetry)}`);

  return lines.join("\n");
}
