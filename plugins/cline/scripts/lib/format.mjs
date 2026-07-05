// Pure rendering of an extracted Result into the markdown the command relays.

const TRANSPORT_SIGNATURES = [
  { key: "session-not-found", pattern: /session not found/i },
  { key: "hook-dispatch-failed", pattern: /hook dispatch failed/i },
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

// One rendering for "the cline subprocess failed" across delegate/review/setup.
export function formatRunFailure(exitCode, stdout, stderr) {
  const detail = String(stderr || stdout || "")
    .trim()
    .split("\n")
    .slice(-5)
    .join("\n");
  return `Cline exited with code ${exitCode}.${detail ? `\n${detail}` : ""}`;
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

  if (result.finishReason != null) telemetry.finishReason = result.finishReason;
  if (annotations.retried) telemetry.retried = true;
  if (annotations.salvaged) telemetry.salvaged = true;
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
