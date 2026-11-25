import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { predictSpans, type RateTable } from "../src/predict.ts";

// Reads source texts and the frozen rate table only.
export function readSources(args: { dir?: string; sealed?: string }): Record<string, string> {
  if (args.dir) {
    return Object.fromEntries(
      readdirSync(args.dir).filter((f) => f.endsWith(".txt")).sort()
        .map((f) => [f.replace(/\.txt$/, ""), readFileSync(join(args.dir!, f), "utf8")]),
    );
  }
  const sealed: { position: number; url: string; excerpt: string }[] = JSON.parse(readFileSync(args.sealed!, "utf8"));
  return Object.fromEntries(
    sealed.map((h) => [`${String(h.position).padStart(2, "0")}-${basename(new URL(h.url).pathname, ".html")}`, h.excerpt]),
  );
}

export function predictAll(sources: Record<string, string>, table: RateTable) {
  const out: Record<string, { file: string; category: string; span: string; predictor: number | null; baseline: number | null; note: string }> = {};
  for (const [name, text] of Object.entries(sources)) {
    predictSpans(text, table).forEach((p, i) => {
      out[`${name}#${i + 1}`] = { file: name, category: p.span.category, span: p.span.text, predictor: p.predictor, baseline: p.baseline, note: p.note };
    });
  }
  return out;
}

function main() {
  const { values } = parseArgs({ options: { dir: { type: "string" }, sealed: { type: "string" }, table: { type: "string" }, out: { type: "string" } } });
  if (!values.table || !values.out || (!values.dir === !values.sealed)) {
    console.error("usage: node audit/predict.ts (--dir <sources> | --sealed <file>) --table <predictions.json> --out <file>");
    process.exit(2);
  }
  const table: RateTable = JSON.parse(readFileSync(values.table, "utf8"));
  const predictions = predictAll(readSources(values), table);
  writeFileSync(values.out, JSON.stringify(predictions, null, 2) + "\n");
  console.log(`${Object.keys(predictions).length} span predictions written to ${values.out}`);
}

if (import.meta.main) main();
