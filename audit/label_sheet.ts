import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stripMarkdown } from "../src/markdown.ts";
import { compare } from "../src/match.ts";
import { similarity } from "../src/similarity.ts";
import { readRecords, toCsv } from "./csv.ts";

// Calibration only. The held-out sheet is built on Day 4, after hand-marking.
const SOURCES = "data/calibration";
const OUTPUTS = "data/outputs/calibration";
const SHEET = "data/labels/calibration_labels.csv";

export const COLUMNS = [
  "span_id", "file", "category", "span", "source_sentence", "closest_output_sentence",
  "label", "override", "reason",
  "matcher_outcome", "matcher_reason", "matcher_text",
];
const HAND = ["label", "override", "reason"];

function sentenceAt(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf("\n"), before.search(/[.!?]\s+(?=[^.!?]*$)/) + 1, 0);
  const rest = text.slice(end).search(/[.!?](\s|$)|\n/);
  const to = rest === -1 ? text.length : end + rest + 1;
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

export function sentences(text: string): string[] {
  return text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function closestSentence(sourceSentence: string, output: string): string {
  let best = "";
  let bestScore = -1;
  for (const candidate of sentences(output)) {
    const score = similarity(sourceSentence, candidate);
    if (score > bestScore) [best, bestScore] = [candidate, score];
  }
  return best;
}

export function buildRows(sourcesDir: string, outputsDir: string): string[][] {
  const rows: string[][] = [];
  for (const file of readdirSync(sourcesDir).filter((f) => f.endsWith(".txt")).sort()) {
    const name = file.replace(/\.txt$/, "");
    const source = readFileSync(join(sourcesDir, file), "utf8");
    const output = readFileSync(join(outputsDir, `${name}.md`), "utf8");
    compare(source, output).forEach((result, i) => {
      const sentence = sentenceAt(source, result.span.start, result.span.end);
      rows.push([
        `${name}#${i + 1}`, name, result.span.category, result.span.text, sentence,
        closestSentence(sentence, stripMarkdown(output)),
        "", "", "",
        result.outcome, result.reason, result.evidence ?? "",
      ]);
    });
  }
  return rows;
}

function main() {
  const refresh = process.argv.includes("--refresh-matcher");
  const rows = buildRows(SOURCES, OUTPUTS);
  if (existsSync(SHEET)) {
    if (!refresh) {
      console.error(`${SHEET} exists. Use --refresh-matcher to regenerate the matcher columns and keep the hand labels.`);
      process.exit(1);
    }
    const old = new Map(readRecords(readFileSync(SHEET, "utf8")).map((r) => [r.span_id, r]));
    const ids = rows.map((r) => r[0]);
    if (ids.length !== old.size || ids.some((id) => !old.has(id))) {
      console.error("The span set changed. That is an extractor change: record it in the addendum before refreshing.");
      process.exit(1);
    }
    for (const row of rows) {
      const previous = old.get(row[0])!;
      for (const column of HAND) row[COLUMNS.indexOf(column)] = previous[column];
    }
  }
  mkdirSync(dirname(SHEET), { recursive: true });
  writeFileSync(SHEET, toCsv([COLUMNS, ...rows]));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row[2]] = (counts[row[2]] ?? 0) + 1;
  console.log(`${SHEET}: ${rows.length} spans ${JSON.stringify(counts)}${refresh ? " (matcher columns refreshed)" : ""}`);
}

if (import.meta.main) main();
