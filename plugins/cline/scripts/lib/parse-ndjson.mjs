// Pure parsing of the NDJSON stream `cline --json` emits.
//
// Event shapes (verified against a real cline 3.0.37 run, see
// docs/cline-cli-contract.md): each line is one JSON object with a `type` of
// "agent_event" | "hook_event" | "run_result". The final "run_result" line is
// authoritative: it carries finishReason, the summary `text`, aggregate usage
// (incl. totalCost) and the model used. Files changed are NOT in the stream —
// they come from git after the run.

export function parseNdjson(stdout) {
  const events = [];
  const malformed = [];
  const lines = String(stdout ?? "").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      malformed.push(index);
    }
  });
  return { events, malformed };
}

export function extractResult(stdout) {
  const { events, malformed } = parseNdjson(stdout);
  const runResult = [...events].reverse().find((e) => e && e.type === "run_result");

  if (!runResult) {
    return {
      ok: false,
      error: "no run_result event found in cline output",
      malformedLines: malformed.length,
    };
  }

  const usage = runResult.aggregateUsage ?? runResult.usage ?? {};
  const toolCalls = events.filter(
    (e) => e && e.type === "hook_event" && e.hookEventName === "tool_call",
  ).length;

  return {
    ok: runResult.finishReason === "completed",
    finishReason: runResult.finishReason ?? null,
    summary: runResult.text ?? "",
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      totalCost: usage.totalCost ?? null,
    },
    model: runResult.model?.id ?? null,
    provider: runResult.model?.provider ?? null,
    durationMs: runResult.durationMs ?? null,
    iterations: runResult.iterations ?? null,
    toolCalls,
    malformedLines: malformed.length,
  };
}
