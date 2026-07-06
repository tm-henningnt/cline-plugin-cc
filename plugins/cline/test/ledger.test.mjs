import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildLedgerEntry,
  formatLedgerSummary,
  summarizeLedger,
} from "../scripts/lib/ledger.mjs";
import { extractResult } from "../scripts/lib/parse-ndjson.mjs";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/delegate-success.ndjson", import.meta.url)),
  "utf8",
);

const NOW = "2026-07-05T09:00:00.000Z";

function line(entry) {
  return JSON.stringify(entry);
}

test("buildLedgerEntry: records successful Run telemetry only", () => {
  const result = extractResult(fixture);
  const entry = buildLedgerEntry({
    cmd: "delegate",
    profile: "quick",
    opts: { provider: "cline-pass", model: "cline-pass/deepseek-v4-flash" },
    out: {
      ok: true,
      result,
      runMeta: {
        exitCode: 0,
        retried: false,
        salvaged: false,
        transport: null,
      },
    },
    nowIso: NOW,
  });

  assert.equal(entry.ts, NOW);
  assert.equal(entry.cmd, "delegate");
  assert.equal(entry.profile, "quick");
  assert.equal(entry.ok, true);
  assert.equal(entry.model, "poolside/laguna-xs-2.1");
  assert.equal(entry.provider, "cline");
  assert.equal(entry.finishReason, "completed");
  assert.equal(entry.transport, null);
  assert.equal(entry.retried, false);
  assert.equal(entry.salvaged, false);
  assert.equal(entry.exitCode, 0);
  assert.equal(entry.costUsd, 0.00079584);
  assert.equal(entry.inputTokens, 18832);
  assert.equal(entry.outputTokens, 296);
  assert.equal("prompt" in entry, false);
  assert.equal("summary" in entry, false);
  assert.equal("taskText" in entry, false);
  assert.doesNotMatch(JSON.stringify(entry), /hello|created/i);
});

test("buildLedgerEntry: failed Run falls back to opts provider and model", () => {
  const entry = buildLedgerEntry({
    cmd: "review",
    profile: "careful",
    opts: { provider: "cline-pass", model: "cline-pass/kimi-k2.7-code" },
    out: {
      ok: false,
      runMeta: {
        exitCode: 1,
        retried: true,
        salvaged: false,
        transport: "hook-dispatch-failed",
      },
    },
    nowIso: NOW,
  });

  assert.equal(entry.ok, false);
  assert.equal(entry.profile, "careful");
  assert.equal(entry.provider, "cline-pass");
  assert.equal(entry.model, "cline-pass/kimi-k2.7-code");
  assert.equal(entry.transport, "hook-dispatch-failed");
  assert.equal(entry.retried, true);
  assert.equal(entry.salvaged, false);
  assert.equal(entry.exitCode, 1);
  assert.equal("costUsd" in entry, false);
});

test("summarizeLedger: tolerates malformed lines and rolls up all-time and 30-day windows", () => {
  const text = [
    line({
      ts: "2026-07-05T08:00:00.000Z",
      model: "cline-pass/a",
      ok: true,
      transport: null,
      retried: false,
      costUsd: 0.1,
      durationMs: 60000,
    }),
    line({
      ts: "2026-07-04T08:00:00.000Z",
      model: "cline-pass/a",
      ok: true,
      transport: null,
      retried: true,
      costUsd: 0.2,
      durationMs: 90000,
    }),
    line({
      ts: "2026-07-03T08:00:00.000Z",
      model: "cline-pass/b",
      ok: true,
      transport: null,
      retried: false,
      costUsd: 0.3,
      durationMs: 30000,
    }),
    line({
      ts: "2026-07-02T08:00:00.000Z",
      model: "cline-pass/b",
      ok: false,
      transport: "session-not-found",
      retried: false,
    }),
    line({
      ts: "2026-05-01T08:00:00.000Z",
      model: "cline-pass/a",
      ok: true,
      transport: null,
      retried: false,
      costUsd: 0.4,
      durationMs: 120000,
    }),
    "{not json",
  ].join("\n");

  const summary = summarizeLedger(text, NOW);

  assert.equal(summary.malformed, 1);
  assert.equal(summary.window30d.runs, 4);
  assert.equal(summary.window30d.okRuns, 3);
  assert.equal(summary.window30d.transportCrashes, 1);
  assert.equal(summary.window30d.retries, 1);
  assert.ok(Math.abs(summary.window30d.costUsd - 0.6) < 0.0000001);
  assert.equal(summary.allTime.runs, 5);
  assert.equal(summary.allTime.okRuns, 4);
  assert.equal(summary.allTime.transportCrashes, 1);
  assert.equal(summary.allTime.retries, 1);
  assert.ok(Math.abs(summary.allTime.costUsd - 1.0) < 0.0000001);
  assert.deepEqual(summary.window30d.byModel, [
    {
      model: "cline-pass/a",
      runs: 2,
      okRuns: 2,
      transportCrashes: 0,
      costUsd: 0.30000000000000004,
      avgDurationMs: 75000,
    },
    {
      model: "cline-pass/b",
      runs: 2,
      okRuns: 1,
      transportCrashes: 1,
      costUsd: 0.3,
      avgDurationMs: 30000,
    },
  ]);
});

test("formatLedgerSummary: renders counts, cost and integer ok percentage", () => {
  const summary = summarizeLedger(
    [
      line({
        ts: "2026-07-05T08:00:00.000Z",
        model: "cline-pass/a",
        ok: true,
        transport: null,
        retried: false,
        costUsd: 0.1,
        durationMs: 60000,
      }),
      line({
        ts: "2026-07-04T08:00:00.000Z",
        model: "cline-pass/a",
        ok: true,
        transport: null,
        retried: true,
        costUsd: 0.2,
        durationMs: 90000,
      }),
      line({
        ts: "2026-07-03T08:00:00.000Z",
        model: "cline-pass/b",
        ok: true,
        transport: null,
        retried: false,
        costUsd: 0.3,
        durationMs: 30000,
      }),
      line({
        ts: "2026-07-02T08:00:00.000Z",
        model: "cline-pass/b",
        ok: false,
        transport: "session-not-found",
        retried: false,
      }),
    ].join("\n"),
    NOW,
  );

  const text = formatLedgerSummary(summary, "/repo/.cline-runs.ndjson");

  assert.match(text, /\*\*Local Run ledger\*\* \(\.cline-runs\.ndjson\)/);
  assert.match(text, /Last 30 days: 4 Runs · 3 ok \(75%\) · 1 transport crashes · 1 retried · \$0\.600000/);
  assert.match(text, /All time: 4 Runs · \$0\.600000/);
  assert.match(text, /cline-pass\/a: 2 Runs · 2 ok · \$0\.300000 · avg 75s/);
});

test("buildLedgerEntry: timed-out transport sets finishReason to timeout", () => {
  const entry = buildLedgerEntry({
    cmd: "delegate",
    profile: "quick",
    opts: { provider: "cline-pass", model: "cline-pass/deepseek-v4-pro" },
    out: {
      ok: false,
      runMeta: {
        exitCode: 1,
        retried: false,
        salvaged: false,
        transport: "timeout",
      },
    },
    nowIso: NOW,
  });

  assert.equal(entry.ok, false);
  assert.equal(entry.transport, "timeout");
  assert.equal(entry.finishReason, "timeout");
  assert.equal("costUsd" in entry, false);
});

test("buildLedgerEntry: non-timeout transport leaves finishReason absent", () => {
  const entry = buildLedgerEntry({
    cmd: "review",
    profile: "careful",
    opts: { provider: "cline-pass", model: "cline-pass/kimi-k2.7-code" },
    out: {
      ok: false,
      runMeta: {
        exitCode: 1,
        retried: true,
        salvaged: false,
        transport: "session-not-found",
      },
    },
    nowIso: NOW,
  });

  assert.equal(entry.ok, false);
  assert.equal(entry.transport, "session-not-found");
  assert.equal("finishReason" in entry, false);
});
