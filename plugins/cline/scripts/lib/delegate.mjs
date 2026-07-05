// The delegate command handler. Pure orchestration over an injected `run`
// (the only impure edge) — this is the seam the tests drive with a fake runner.

import { buildDelegateArgv } from "./argv.mjs";
import { executeRun } from "./attempt.mjs";

// deps.run(argv, { cwd, input }) -> { stdout, stderr, exitCode }
export async function delegate(opts, deps) {
  const argv = buildDelegateArgv(opts);
  return executeRun(argv, { cwd: opts.cwd, input: opts.stdin }, deps);
}
