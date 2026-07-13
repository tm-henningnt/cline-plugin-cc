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
    assert.match(skill, /CLINE_PLUGIN_HOST=codex/);
  }

  const delegate = readFileSync(path("skills/delegate/SKILL.md"), "utf8");
  assert.match(delegate, /explicit user request/i);
  assert.match(delegate, /CLINE_PLUGIN_HOST=codex/);

  const modelFeed = readFileSync(path("skills/model-feed/SKILL.md"), "utf8");
  assert.match(modelFeed, /explicit user request/i);

  const review = readFileSync(path("skills/review/SKILL.md"), "utf8");
  assert.match(review, /git diff/);
  assert.match(review, /CLINE_PLUGIN_HOST=codex/);

  const setup = readFileSync(path("skills/setup/SKILL.md"), "utf8");
  assert.match(setup, /\$cline:setup/);
  assert.match(setup, /CLINE_PLUGIN_HOST=codex/);

  const readme = readFileSync(path("../../README.md"), "utf8");
  assert.match(readme, /Recommended Codex AGENTS\.md guidance/);
  assert.match(readme, /\[sandbox_workspace_write\]/);
  assert.match(readme, /network_access = true/);
  assert.match(readme, /codex plugin list/);
  assert.match(readme, /\/cline:setup` \/ `\$cline:setup/);

  const pluginReadme = readFileSync(path("README.md"), "utf8");
  assert.match(pluginReadme, /network_access = true/);
  assert.match(pluginReadme, /codex plugin list/);
});
