import { formatResult, formatRunFailure, isTransportRetryable, transportSignature } from "./format.mjs";
import { extractResult, parseNdjson } from "./parse-ndjson.mjs";

export const TRANSPORT_RETRY_NOTE =
  "Note: cline hit a transport error (known signature) and the Run was retried once.";

function buildRunMeta(exitCode, { retried, salvaged, transport }) {
  return {
    exitCode,
    retried,
    salvaged,
    transport,
  };
}

function formatAttempt({ stdout, stderr, exitCode }, { retried = false, transport = null } = {}) {
  const signature = transportSignature(exitCode, stdout, stderr);
  const runMetaBase = {
    retried,
    transport: transport ?? signature,
  };

  if (exitCode !== 0) {
    const result = extractResult(stdout);
    if (result.ok) {
      return {
        output: {
          ok: true,
          text:
            `Warning: cline exited with code ${exitCode} after completing the Run ` +
            `(transport error on shutdown); the completed result below was salvaged from its output.\n\n` +
            formatResult(result, { retried, salvaged: true }),
          result,
          runMeta: buildRunMeta(exitCode, { ...runMetaBase, salvaged: true }),
        },
        shouldRetry: false,
      };
    }

    const { events } = parseNdjson(stdout);
    const toolCalls = events.filter(
      (e) => e && e.type === "hook_event" && e.hookEventName === "tool_call",
    ).length;
    const failureMeta = {
      transport: runMetaBase.transport,
      retried: runMetaBase.retried,
      salvaged: false,
      toolCalls,
    };

    return {
      output: {
        ok: false,
        text: formatRunFailure(exitCode, stdout, stderr, failureMeta),
        runMeta: buildRunMeta(exitCode, { ...runMetaBase, salvaged: false }),
      },
      shouldRetry: isTransportRetryable(exitCode, stdout, stderr),
    };
  }

  const result = extractResult(stdout);
  return {
    output: {
      ok: result.ok,
      text: formatResult(result, { retried }),
      result,
      runMeta: buildRunMeta(exitCode, { ...runMetaBase, salvaged: false }),
    },
    shouldRetry: false,
  };
}

// Runs one Run via deps.run, salvaging completed Results on non-zero exit and
// retrying a known transport crash once. Shared by the delegate and review handlers.
export async function executeRun(argv, { cwd, input }, deps) {
  const first = formatAttempt(await deps.run(argv, { cwd, input }));
  if (!first.shouldRetry) return first.output;
  const second = formatAttempt(await deps.run(argv, { cwd, input }), {
    retried: true,
    transport: first.output.runMeta.transport,
  });
  return { ...second.output, text: `${TRANSPORT_RETRY_NOTE}\n\n${second.output.text}` };
}
