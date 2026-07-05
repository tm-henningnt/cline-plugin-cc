// CI helper: fail if any hand-maintained JSON file is unparseable.
import { readFileSync } from "node:fs";

const files = [
  ".claude-plugin/marketplace.json",
  "plugins/cline/.claude-plugin/plugin.json",
  "plugins/cline/data/clinepass-models.json",
  "package.json",
];

for (const file of files) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exit(1);
  }
}
