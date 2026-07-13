import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const path = (relative) => new URL(relative, root).pathname;

test("Codex plugin exposes all Cline operations through the shared dispatcher", () => {
  const manifestPath = path(".codex-plugin/plugin.json");
  assert.equal(existsSync(manifestPath), true);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, "cline");
  assert.equal(manifest.skills, "./skills/");

  for (const operation of ["delegate", "review", "setup", "usage", "profiles", "model-feed"]) {
    const skillPath = join(path("skills"), operation, "SKILL.md");
    assert.equal(existsSync(skillPath), true, `${operation} skill exists`);
    const skill = readFileSync(skillPath, "utf8");
    assert.match(skill, new RegExp(`dispatcher\\.mjs" ${operation}`));
    assert.match(skill, /PLUGIN_ROOT/);
  }

  const delegate = readFileSync(path("skills/delegate/SKILL.md"), "utf8");
  assert.match(delegate, /explicit user request/i);

  const modelFeed = readFileSync(path("skills/model-feed/SKILL.md"), "utf8");
  assert.match(modelFeed, /explicit user request/i);

  const review = readFileSync(path("skills/review/SKILL.md"), "utf8");
  assert.match(review, /git diff/);
});
