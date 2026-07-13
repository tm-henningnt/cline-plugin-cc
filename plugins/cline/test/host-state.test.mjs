import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveClineState, shellQuote, withClineState } from "../scripts/lib/host-state.mjs";

test("host state: non-Codex Hosts keep Cline's default state", () => {
  assert.deepEqual(resolveClineState({ env: {}, cwd: "/work/project", home: "/home/user" }), {
    ok: true,
    host: null,
    stateRoot: null,
  });
});

test("host state: Codex uses a user-owned default state root", () => {
  assert.deepEqual(
    resolveClineState({ env: { CLINE_PLUGIN_HOST: "codex" }, cwd: "/work/project", home: "/home/user" }),
    { ok: true, host: "codex", stateRoot: "/home/user/.codex/cline" },
  );
});

test("host state: Codex accepts an explicit state-root override outside the project", () => {
  assert.deepEqual(
    resolveClineState({
      env: { CLINE_PLUGIN_HOST: "codex", CLINE_CODEX_DATA_DIR: "/var/state/cline" },
      cwd: "/work/project",
      home: "/home/user",
    }),
    { ok: true, host: "codex", stateRoot: "/var/state/cline" },
  );
});

test("host state: Codex rejects a state root inside the project", () => {
  const out = resolveClineState({
    env: { CLINE_PLUGIN_HOST: "codex", CLINE_CODEX_DATA_DIR: "/work/project/.cline" },
    cwd: "/work/project",
    home: "/home/user",
  });
  assert.equal(out.ok, false);
  assert.match(out.text, /must be outside the project/);
});

test("host state: Codex rejects an invoking worktree root even when the Run cwd is elsewhere", () => {
  const project = mkdtempSync(join(tmpdir(), "cline-codex-project-"));
  const external = mkdtempSync(join(tmpdir(), "cline-codex-external-"));
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "nested"));
    const out = resolveClineState({
      env: { CLINE_PLUGIN_HOST: "codex", CLINE_CODEX_DATA_DIR: join(project, ".cline-state") },
      cwd: external,
      invocationCwd: join(project, "nested"),
      home: "/home/user",
    });
    assert.equal(out.ok, false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("host state: Codex rejects an outside symlink whose target is in the worktree", () => {
  const project = mkdtempSync(join(tmpdir(), "cline-codex-project-"));
  const external = mkdtempSync(join(tmpdir(), "cline-codex-external-"));
  try {
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, ".cline-state"));
    const stateLink = join(external, "state-link");
    symlinkSync(join(project, ".cline-state"), stateLink);
    const out = resolveClineState({
      env: { CLINE_PLUGIN_HOST: "codex", CLINE_CODEX_DATA_DIR: stateLink },
      cwd: project,
      invocationCwd: project,
      home: "/home/user",
    });
    assert.equal(out.ok, false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("host state: only Codex invocations receive Cline's data-dir argument", () => {
  assert.deepEqual(withClineState(["--json"], { stateRoot: "/var/state/cline" }), [
    "--data-dir",
    "/var/state/cline",
    "--json",
  ]);
  assert.deepEqual(withClineState(["--json"], { stateRoot: null }), ["--json"]);
});

test("host state: shell quote keeps configured paths literal", () => {
  assert.equal(shellQuote("/home/user/Cline State"), "'/home/user/Cline State'");
  assert.equal(shellQuote("/home/user/it's-cline"), "'/home/user/it\"'\"'s-cline'");
});
