import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { qualifyingPhrases } from "../src/lexicon.ts";

// Calibration excerpts only. Never point this at held-out text.
const DIR = "data/calibration";
const PYTHON = `
import json, sys
sys.path.insert(0, ".")
from intact.lexicon import qualifying_phrases
print(json.dumps({p: qualifying_phrases(open(p, encoding="utf-8").read()) for p in sys.argv[1:]}))
`;

const paths = readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort().map((f) => join(DIR, f));
const python: Record<string, string[]> = JSON.parse(
  execFileSync("python3", ["-I", "-c", PYTHON, ...paths], { encoding: "utf8" }),
);

let mismatches = 0;
for (const path of paths) {
  const ts = qualifyingPhrases(readFileSync(path, "utf8"));
  const same = JSON.stringify(ts) === JSON.stringify(python[path]);
  if (!same) mismatches++;
  console.log(`${same ? "same" : "DIFFERENT"}  ${path}  (${ts.length} phrases)`);
  if (!same) console.log(`  python: ${JSON.stringify(python[path])}\n  ts:     ${JSON.stringify(ts)}`);
}
console.log(`${paths.length - mismatches} of ${paths.length} excerpts match`);
process.exitCode = mismatches ? 1 : 0;
