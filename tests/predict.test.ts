import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { predictSpans, type RateTable } from "../src/predict.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE: RateTable = {
  categories: {
    limit: { rate: 0.2, status: "ok" },
    time: { rate: 0.1, status: "ok" },
    quantity: { rate: null, status: "insufficient" },
  },
  baseline: { rate: 0.15 },
};

function imports(file: string, local = new Set<string>(), external = new Set<string>()) {
  if (local.has(file)) return { local, external };
  local.add(file);
  for (const m of readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
    if (m[1].startsWith(".")) imports(resolve(dirname(file), m[1]), local, external);
    else external.add(m[1]);
  }
  return { local, external };
}

test("each span gets its category's rate, or none under minimum support", () => {
  const out = predictSpans("Wait at least 2 hours. Rest for 10 days. Use 5 mL.", TABLE);
  assert.deepEqual(out.map((p) => [p.span.category, p.predictor, p.baseline, p.note]), [
    ["limit", 0.2, 0.15, ""],
    ["time", 0.1, 0.15, ""],
    ["quantity", null, null, "Insufficient calibration data"],
  ]);
});

test("separation: the predictor never reaches the matcher, the markdown stripper or the file system", () => {
  const { local, external } = imports(join(ROOT, "src/predict.ts"));
  const names = [...local].map((f) => basename(f));
  assert.ok(!names.includes("match.ts") && !names.includes("markdown.ts"), names.join(", "));
  assert.deepEqual([...external], []);
});

test("separation: the prediction runner never reaches the matcher or the markdown stripper", () => {
  const names = [...imports(join(ROOT, "audit/predict.ts")).local].map((f) => basename(f));
  assert.ok(!names.includes("match.ts") && !names.includes("markdown.ts"), names.join(", "));
});

test("separation: predictions are the same whether output files exist or not", () => {
  const dir = mkdtempSync(join(tmpdir(), "intact-predict-"));
  mkdirSync(join(dir, "sources"));
  writeFileSync(join(dir, "sources", "01-example.txt"), "Wait at least 2 hours. Rest for 10 days. Use 5 mL.");
  writeFileSync(join(dir, "table.json"), JSON.stringify(TABLE));
  const run = (out: string) => {
    execFileSync("node", [
      join(ROOT, "audit/predict.ts"), "--dir", join(dir, "sources"), "--table", join(dir, "table.json"), "--out", join(dir, out),
    ], { cwd: dir });
    return readFileSync(join(dir, out), "utf8");
  };
  const without = run("without.json");
  mkdirSync(join(dir, "outputs"));
  writeFileSync(join(dir, "outputs", "01-example.md"), "Wait 2 hours. Rest for a while.");
  assert.equal(run("with.json"), without);
  assert.equal(Object.keys(JSON.parse(without)).length, 3);
});
