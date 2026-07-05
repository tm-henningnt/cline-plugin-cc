// The review command handler. Pure orchestration over an injected `run`
// (the only impure edge) - Cline receives the diff on stdin and runs in plan
// mode so it cannot write to the working tree.

import { buildDelegateArgv } from "./argv.mjs";
import { executeRun } from "./attempt.mjs";

function buildReviewPrompt(opts) {
  const baseLine = opts.base ? ` The diff was produced against ${opts.base}.` : "";
  return [
    "Review the git diff provided on stdin for bugs, regressions, risks, and missing tests.",
    "List findings first, ordered by severity, with file and line references where possible.",
    "This is a read-only code review: do not edit files, do not apply fixes, and do not ask to make changes.",
    "If there are no findings, say so clearly.",
    baseLine,
  ]
    .join(" ")
    .trim();
}

// deps.run(argv, { cwd, input }) -> { stdout, stderr, exitCode }
export async function review(opts, deps) {
  if (!String(opts.diff ?? "").trim()) {
    return { ok: true, text: "No changes to review." };
  }

  const argv = buildDelegateArgv({
    plan: true,
    provider: opts.provider,
    model: opts.model,
    cwd: opts.cwd,
    timeoutSeconds: opts.timeoutSeconds,
    prompt: buildReviewPrompt(opts),
  });

  return executeRun(argv, { cwd: opts.cwd, input: opts.diff }, deps);
}
