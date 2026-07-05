// Pure functions for turning delegate options into a `cline` argv, and for
// parsing the raw slash-command argument string into those options.
//
// Real cline v3 flags (from `cline --help`): `--json`, `-P/--provider`,
// `-m/--model`, `-p/--plan`, `-c/--cwd`, `-t/--timeout`. Auto-approval defaults
// to true, so a normal (writing) delegate needs no approval flag; plan mode
// (`-p`) is how we run without touching files.

// ClinePass is its own provider id (`cline-pass`), distinct from `cline` — only
// `cline-pass` spends the flat ClinePass subscription, so it is the default.
const DEFAULT_PROVIDER = "cline-pass";

export function buildDelegateArgv(opts = {}) {
  const argv = ["--json", "-P", opts.provider ?? DEFAULT_PROVIDER];
  if (opts.model) argv.push("-m", opts.model);
  if (opts.plan || opts.readOnly) argv.push("-p");
  if (opts.cwd) argv.push("-c", opts.cwd);
  if (opts.timeoutSeconds != null) argv.push("-t", String(opts.timeoutSeconds));
  if (opts.prompt) argv.push(opts.prompt);
  return argv;
}

// Split a shell-ish string into tokens, honoring single/double quotes so a
// quoted prompt survives as one token. Not a full shell parser - good enough
// for the argument string Claude Code hands us via $ARGUMENTS.
function tokenizeWithOffsets(str) {
  const matches = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    matches.push({ token: m[1] ?? m[2] ?? m[3], index: m.index });
  }
  return matches;
}

export function tokenize(str) {
  return tokenizeWithOffsets(str).map(({ token }) => token);
}

const FLAGS_WITH_VALUE = new Map([
  ["--model", "model"],
  ["--profile", "profile"],
  ["--provider", "provider"],
  ["--timeout", "timeoutSeconds"],
  ["--cwd", "cwd"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--plan", "plan"],
  ["--read-only", "readOnly"],
]);

const REVIEW_FLAGS_WITH_VALUE = new Map([
  ["--base", "base"],
  ["--model", "model"],
  ["--profile", "profile"],
  ["--provider", "provider"],
  ["--timeout", "timeoutSeconds"],
  ["--cwd", "cwd"],
]);

function normalizeArgTokens(argvOrString) {
  if (Array.isArray(argvOrString)) {
    return argvOrString.length === 1 ? tokenize(argvOrString[0]) : argvOrString.slice();
  }
  return tokenize(String(argvOrString ?? ""));
}

function recognizedFlag(tok, valueFlags, booleanFlags) {
  return valueFlags.has(tok) || booleanFlags.has(tok);
}

function coerceFlagValue(key, val) {
  return key === "timeoutSeconds" ? Number(val) : val;
}

function consumeFlags(tokens, valueFlags, booleanFlags, { stopAtFirstNonFlag }) {
  const opts = {};
  const remainder = [];
  let inRemainder = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!inRemainder && booleanFlags.has(tok)) {
      opts[booleanFlags.get(tok)] = true;
      continue;
    }
    if (!inRemainder && valueFlags.has(tok)) {
      const key = valueFlags.get(tok);
      const val = tokens[i + 1];
      if (val === undefined || recognizedFlag(val, valueFlags, booleanFlags)) {
        opts[key] = coerceFlagValue(key, undefined);
        continue;
      }
      i++;
      opts[key] = coerceFlagValue(key, val);
      continue;
    }
    if (stopAtFirstNonFlag) {
      inRemainder = true;
      remainder.push(tok);
    }
  }

  return { opts, remainder };
}

function stripOneOuterQuotePair(rawPrompt) {
  const first = rawPrompt[0];
  if (rawPrompt.length >= 2 && (first === '"' || first === "'") && rawPrompt.at(-1) === first) {
    return rawPrompt.slice(1, -1);
  }
  return rawPrompt;
}

function parseDelegateStringArgs(source) {
  const opts = {};
  const matches = tokenizeWithOffsets(source);

  for (let i = 0; i < matches.length; i++) {
    const { token, index } = matches[i];
    if (BOOLEAN_FLAGS.has(token)) {
      opts[BOOLEAN_FLAGS.get(token)] = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(token)) {
      const key = FLAGS_WITH_VALUE.get(token);
      const val = matches[i + 1]?.token;
      if (val === undefined || recognizedFlag(val, FLAGS_WITH_VALUE, BOOLEAN_FLAGS)) {
        opts[key] = coerceFlagValue(key, undefined);
        continue;
      }
      i++;
      opts[key] = coerceFlagValue(key, val);
      continue;
    }

    opts.prompt = stripOneOuterQuotePair(source.slice(index));
    return opts;
  }

  opts.prompt = "";
  return opts;
}

// Parse the delegate argument list. Accepts either an already-split argv or a
// single string (the common `"$ARGUMENTS"` case). Recognised leading flags are
// pulled off; for the single-string path, the prompt is passed to cline
// verbatim from the first non-flag character onward (one outer quote pair
// stripped if present).
export function parseDelegateArgs(argvOrString) {
  if (!Array.isArray(argvOrString) || argvOrString.length === 1) {
    const source = Array.isArray(argvOrString) ? String(argvOrString[0]) : String(argvOrString ?? "");
    return parseDelegateStringArgs(source);
  }

  const tokens = normalizeArgTokens(argvOrString);
  const { opts, remainder } = consumeFlags(tokens, FLAGS_WITH_VALUE, BOOLEAN_FLAGS, {
    stopAtFirstNonFlag: true,
  });
  opts.prompt = remainder.join(" ");
  return opts;
}

export function parseReviewArgs(argvOrString) {
  const tokens = normalizeArgTokens(argvOrString);
  const { opts } = consumeFlags(tokens, REVIEW_FLAGS_WITH_VALUE, new Map(), {
    stopAtFirstNonFlag: false,
  });
  return opts;
}
