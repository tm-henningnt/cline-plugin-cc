import { formatUsd } from "./format.mjs";

const WINDOW_30D_MS = 30 * 24 * 60 * 60 * 1000;

function finiteNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setKnown(target, key, value) {
  if (value != null) target[key] = value;
}

export function buildLedgerEntry({ cmd, profile, opts = {}, out = {}, nowIso }) {
  const result = out.result ?? {};
  const runMeta = out.runMeta ?? {};
  const entry = {
    ts: nowIso,
    ok: out.ok === true,
    transport: runMeta.transport ?? null,
    retried: runMeta.retried === true,
    salvaged: runMeta.salvaged === true,
  };

  setKnown(entry, "cmd", cmd);
  setKnown(entry, "profile", profile);
  setKnown(entry, "runId", opts.runId ?? runMeta.runId);
  setKnown(entry, "provider", result.provider ?? opts.provider);
  setKnown(entry, "model", result.model ?? opts.model);

  // Classify a timed-out or stalled Run in the ledger (finishReason not available from
  // the run_result stream when the CLI exits non-zero without a completed
  // result).
  const finishReason =
    result.finishReason ??
    (runMeta.transport === "timeout" || runMeta.transport === "stalled" ? runMeta.transport : null);
  setKnown(entry, "finishReason", finishReason);

  const exitCode = finiteNumber(runMeta.exitCode);
  if (exitCode != null) entry.exitCode = exitCode;

  const costUsd = finiteNumber(result.usage?.totalCost);
  if (costUsd != null) entry.costUsd = costUsd;

  const durationMs = finiteNumber(result.durationMs);
  if (durationMs != null) entry.durationMs = durationMs;

  const toolCalls = finiteNumber(result.toolCalls);
  if (toolCalls != null) entry.toolCalls = toolCalls;

  const inputTokens = finiteNumber(result.usage?.inputTokens);
  if (inputTokens != null) entry.inputTokens = inputTokens;

  const outputTokens = finiteNumber(result.usage?.outputTokens);
  if (outputTokens != null) entry.outputTokens = outputTokens;

  return entry;
}

function emptyTotals() {
  return {
    runs: 0,
    okRuns: 0,
    transportCrashes: 0,
    retries: 0,
    costUsd: 0,
    byModel: [],
  };
}

function addEntry(totals, modelTotals, entry) {
  totals.runs += 1;
  if (entry.ok === true) totals.okRuns += 1;
  if (entry.transport != null && entry.transport !== "") totals.transportCrashes += 1;
  if (entry.retried === true) totals.retries += 1;

  const costUsd = finiteNumber(entry.costUsd) ?? 0;
  totals.costUsd += costUsd;

  const model = entry.model == null || entry.model === "" ? "(unknown model)" : String(entry.model);
  const modelTotal =
    modelTotals.get(model) ??
    {
      model,
      runs: 0,
      okRuns: 0,
      transportCrashes: 0,
      costUsd: 0,
      durationMsTotal: 0,
      durationCount: 0,
    };
  modelTotal.runs += 1;
  if (entry.ok === true) modelTotal.okRuns += 1;
  if (entry.transport != null && entry.transport !== "") modelTotal.transportCrashes += 1;
  modelTotal.costUsd += costUsd;

  const durationMs = finiteNumber(entry.durationMs);
  if (durationMs != null) {
    modelTotal.durationMsTotal += durationMs;
    modelTotal.durationCount += 1;
  }

  modelTotals.set(model, modelTotal);
}

function finalizeTotals(totals, modelTotals) {
  return {
    ...totals,
    byModel: [...modelTotals.values()]
      .map((item) => ({
        model: item.model,
        runs: item.runs,
        okRuns: item.okRuns,
        transportCrashes: item.transportCrashes,
        costUsd: item.costUsd,
        avgDurationMs:
          item.durationCount > 0 ? item.durationMsTotal / item.durationCount : null,
      }))
      .sort(
        (a, b) =>
          b.costUsd - a.costUsd ||
          b.runs - a.runs ||
          a.model.localeCompare(b.model),
      ),
  };
}

export function summarizeLedger(ndjsonText, nowIso) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`Invalid nowIso: ${nowIso}`);
  }

  let malformed = 0;
  const allTime = emptyTotals();
  const window30d = emptyTotals();
  const allTimeModels = new Map();
  const window30dModels = new Map();

  for (const line of String(ndjsonText ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }

    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      malformed += 1;
      continue;
    }

    addEntry(allTime, allTimeModels, entry);

    const tsMs = Date.parse(entry.ts ?? "");
    if (Number.isFinite(tsMs) && tsMs >= nowMs - WINDOW_30D_MS) {
      addEntry(window30d, window30dModels, entry);
    }
  }

  return {
    malformed,
    allTime: finalizeTotals(allTime, allTimeModels),
    window30d: finalizeTotals(window30d, window30dModels),
  };
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function runsLabel(count) {
  return `${count} ${count === 1 ? "Run" : "Runs"}`;
}

function displayPath(ledgerPath) {
  return String(ledgerPath || ".cline-runs.ndjson")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || ".cline-runs.ndjson";
}

export function formatLedgerSummary(summary, ledgerPath) {
  const window = summary.window30d;
  const allTime = summary.allTime;
  const lines = [
    `**Local Run ledger** (${displayPath(ledgerPath)})`,
    "",
    `- Last 30 days: ${runsLabel(window.runs)} · ${window.okRuns} ok (${percent(
      window.okRuns,
      window.runs,
    )}%) · ${window.transportCrashes} transport crashes · ${window.retries} retried · ${formatUsd(
      window.costUsd,
    )}`,
    `- All time: ${runsLabel(allTime.runs)} · ${formatUsd(allTime.costUsd)}`,
  ];

  if (window.byModel.length) {
    lines.push("- By model, last 30 days:");
    for (const item of window.byModel) {
      const avg =
        item.avgDurationMs == null ? "" : ` · avg ${Math.round(item.avgDurationMs / 1000)}s`;
      lines.push(
        `  - ${item.model}: ${runsLabel(item.runs)} · ${item.okRuns} ok · ${formatUsd(
          item.costUsd,
        )}${avg}`,
      );
    }
  }

  return lines.join("\n");
}
