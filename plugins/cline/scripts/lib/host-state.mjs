import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const CODEX_HOST = "codex";
export const CODEX_STATE_DIR_ENV = "CLINE_CODEX_DATA_DIR";
export const PLUGIN_HOST_ENV = "CLINE_PLUGIN_HOST";

function isWithin(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalize(path, fs = { existsSync, realpathSync }) {
  let current = resolve(path);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    suffix.unshift(basename(current));
    current = parent;
  }
  try {
    return join(fs.realpathSync(current), ...suffix);
  } catch {
    return resolve(path);
  }
}

function findProjectRoot(startDir, fs = { existsSync }) {
  let current = resolve(startDir);
  while (true) {
    const gitPath = join(current, ".git");
    if (fs.existsSync(gitPath)) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

export function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `"'"'`)}'`;
}

export function resolveClineState({
  env = process.env,
  cwd = process.cwd(),
  invocationCwd = process.cwd(),
  home = homedir(),
  fs,
} = {}) {
  if (env[PLUGIN_HOST_ENV] !== CODEX_HOST) return { ok: true, host: null, stateRoot: null };

  const configured = String(env[CODEX_STATE_DIR_ENV] ?? "").trim();
  const stateRoot = resolve(configured || `${home}/.codex/cline`);
  const filesystem = fs ?? { existsSync, realpathSync };
  const canonicalStateRoot = canonicalize(stateRoot, filesystem);
  const projectRoots = [...new Set([cwd, invocationCwd].map((dir) => findProjectRoot(dir, filesystem)))];
  if (projectRoots.some((projectRoot) => isWithin(canonicalize(projectRoot, filesystem), canonicalStateRoot))) {
    return {
      ok: false,
      host: CODEX_HOST,
      stateRoot,
      text: `Codex Cline state directory must be outside the project: ${stateRoot}. Set ${CODEX_STATE_DIR_ENV} to a user-owned directory such as ~/.codex/cline.`,
    };
  }
  return { ok: true, host: CODEX_HOST, stateRoot };
}

export function withClineState(argv, state) {
  if (!state?.stateRoot) return argv;
  return ["--data-dir", state.stateRoot, ...argv];
}
