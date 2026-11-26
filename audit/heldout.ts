import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Category } from "../src/extract.ts";
import { parseCsv, readRecords, toCsv } from "./csv.ts";
import { readSources } from "./predict.ts";
import { CATEGORIES } from "./rates.ts";
import type { HandMark } from "./score.ts";

// Day 4 helpers. Nothing here prints held-out text: only counts, positions and row numbers.
const SEALED = "data/heldout_sealed.json";
const LOCKS = "locks.txt";
const DIR = "data/heldout";
const OPENED = "data/heldout_opened.txt";
const SPANS = join(DIR, "hand_spans.csv");
const MARKS = join(DIR, "hand_marks.csv");
const PREDICTIONS = "data/heldout_predictions.json";
const RECALL = "data/heldout_recall.json";
const OUTPUTS = "data/outputs/heldout";
const SHEET = "data/labels/heldout_labels.csv";

export const SPAN_COLUMNS = ["file", "sentence_no", "sentence", "text", "category", "note"];
const MARK_COLUMNS = ["file", "text", "occurrence", "category"];

export function sentenceRanges(text: string) {
  const out: { start: number; end: number; sentence: string }[] = [];
  let start = 0;
  for (const m of [...text.matchAll(/\n+|(?<=[.!?])\s+/g), null]) {
    const end = m ? m.index : text.length;
    const sentence = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (sentence) out.push({ start, end, sentence });
    if (m) start = m.index + m[0].length;
  }
  return out;
}

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")!.value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`;
}

export function unseal(paths = { sealed: SEALED, locks: LOCKS, dir: DIR, opened: OPENED }) {
  const hash = createHash("sha256").update(readFileSync(paths.sealed)).digest("hex");
  const locked = readFileSync(paths.locks, "utf8").split("\n").map((l) => l.split("\t")).find((f) => f[1]?.includes("heldout_sealed.json"))?.[2];
  if (hash !== locked) throw new Error(`${paths.sealed} does not match its fingerprint in ${paths.locks}`);
  if (existsSync(paths.dir) || existsSync(paths.opened)) throw new Error(`${paths.dir} or ${paths.opened} already exists; unseal runs once`);

  const sources = readSources({ sealed: paths.sealed });
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.opened, `${stamp(new Date())}\tsealed file opened by audit/heldout.ts unseal\t${hash}\n`);
  const rows: string[][] = [];
  for (const [name, text] of Object.entries(sources)) {
    writeFileSync(join(paths.dir, `${name}.txt`), text);
    sentenceRanges(text).forEach((s, i) => rows.push([name, String(i + 1), s.sentence, "", "", ""]));
  }
  writeFileSync(join(paths.dir, "hand_spans.csv"), toCsv([SPAN_COLUMNS, ...rows]));
  return { names: Object.keys(sources), sentences: rows.length };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Counts the way the frozen scorer's locate() does, overlaps included.
function occurrenceAt(source: string, text: string, at: number): number {
  let n = 1;
  for (let from = source.indexOf(text); from !== at; from = source.indexOf(text, from + 1)) n++;
  return n;
}

export function checkMarks(csv: string, sources: Record<string, string>) {
  const [header, ...data] = parseCsv(csv);
  const problems: string[] = [];
  const notes: string[] = [];
  const marks: HandMark[] = [];
  const byText = new Map<string, number[]>();
  data.forEach((values, i) => {
    const row = Object.fromEntries(header.map((h, j) => [h, values[j] ?? ""]));
    const line = i + 2;
    const text = (row.text ?? "").trim();
    const category = (row.category ?? "").trim();
    if (!text) {
      if (category) problems.push(`row ${line}: a category but no text`);
      return;
    }
    const source = sources[row.file];
    const sentence = source === undefined ? undefined : sentenceRanges(source)[Number(row.sentence_no) - 1];
    if (!sentence || sentence.sentence !== row.sentence) {
      problems.push(`row ${line}: file, sentence_no and sentence don't match the source`);
      return;
    }
    if (!CATEGORIES.includes(category as Category)) problems.push(`row ${line}: category must be limit, time or quantity`);
    const pattern = new RegExp(text.split(/\s+/).map(escape).join("\\s+"), "gi");
    const hits = [...source.slice(sentence.start, sentence.end).matchAll(pattern)];
    if (!hits.length) {
      problems.push(`row ${line}: text not found in its sentence`);
      return;
    }
    if (hits.length > 1) notes.push(`row ${line}: text appears ${hits.length} times in its sentence; the first is used`);
    const exact = hits[0][0];
    marks.push({ file: row.file, text: exact, occurrence: occurrenceAt(source, exact, sentence.start + hits[0].index), category: category as Category });
    const key = `${row.file}\t${exact.toLowerCase()}`;
    byText.set(key, [...(byText.get(key) ?? []), line]);
  });
  for (const lines of byText.values()) {
    if (lines.length > 1) notes.push(`rows ${lines.join(", ")}: the same text marked twice in one file; check they're different details (#3)`);
  }
  return { marks, problems, notes };
}

function check() {
  const sources = readSources({ sealed: SEALED });
  const problems: string[] = [];
  for (const [name, text] of Object.entries(sources)) {
    const file = join(DIR, `${name}.txt`);
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) problems.push(`${name.slice(0, 2)}: excerpt file differs from the sealed text`);
  }
  const extra = readdirSync(DIR).filter((f) => f.endsWith(".txt") && !(f.replace(/\.txt$/, "") in sources));
  if (extra.length) problems.push(`${extra.length} .txt file(s) in ${DIR} are not held-out excerpts`);
  const result = checkMarks(readFileSync(SPANS, "utf8"), sources);
  problems.push(...result.problems);
  for (const note of result.notes) console.log(`check: ${note}`);
  if (problems.length) {
    console.error(`Nothing written. Fix these first:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  writeFileSync(MARKS, toCsv([MARK_COLUMNS, ...result.marks.map((m) => [m.file, m.text, String(m.occurrence), m.category])]));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, result.marks.filter((m) => m.category === c).length]));
  const files = new Set(result.marks.map((m) => m.file)).size;
  console.log(`${MARKS}: ${result.marks.length} marks in ${files} of ${Object.keys(sources).length} excerpts ${JSON.stringify(counts)}`);
}

async function recall() {
  const { extractorRecall } = await import("./score.ts");
  // Parsed exactly as the frozen scorer parses --hand-marks.
  const marks = readRecords(readFileSync(MARKS, "utf8"))
    .map((m) => ({ file: m.file, text: m.text, occurrence: Number(m.occurrence || 1), category: m.category as Category }));
  const result = extractorRecall(marks, readSources({ sealed: SEALED }));
  writeFileSync(RECALL, JSON.stringify(result, null, 2) + "\n");
  console.log(`extractor recall: ${result.found} of ${result.located} hand-marked spans found (${result.categoryAgrees} with the same category), ${result.misses.length} missed, ${result.notLocated.length} not located`);
  console.log(`wrote ${RECALL}`);
}

async function sheet() {
  const { buildRows, COLUMNS } = await import("./label_sheet.ts");
  if (existsSync(SHEET)) throw new Error(`${SHEET} exists; refresh it with label_sheet.ts rules, not by rebuilding`);
  const predictions: Record<string, { file: string; category: string; span: string }> = JSON.parse(readFileSync(PREDICTIONS, "utf8"));
  const names = readdirSync(DIR).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
  const left = names.filter((n) => existsSync(join(OUTPUTS, `${n}.md`)));
  // A2 can leave an excerpt out; buildRows expects an output for every source, so give it only those with one.
  let dir = DIR;
  if (left.length < names.length) {
    dir = mkdtempSync(join(tmpdir(), "intact-heldout-"));
    for (const n of left) copyFileSync(join(DIR, `${n}.txt`), join(dir, `${n}.txt`));
  }
  const rows = buildRows(dir, OUTPUTS);
  if (dir !== DIR) rmSync(dir, { recursive: true });

  // The sheet and the committed predictions must name the same spans.
  const expected = Object.values(predictions).filter((p) => left.includes(p.file)).length;
  const mismatched = rows.filter((r) => predictions[r[0]]?.category !== r[2] || predictions[r[0]]?.span !== r[3]).length;
  if (mismatched || rows.length !== expected) throw new Error(`${mismatched} sheet rows differ from ${PREDICTIONS}; ${rows.length} rows for ${expected} predictions`);

  mkdirSync(join(SHEET, ".."), { recursive: true });
  writeFileSync(SHEET, toCsv([COLUMNS, ...rows]));
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, rows.filter((r) => r[2] === c).length]));
  console.log(`${SHEET}: ${rows.length} spans ${JSON.stringify(counts)} from ${left.length} of ${names.length} excerpts`);
}

if (import.meta.main) {
  const commands: Record<string, () => unknown> = {
    unseal: () => {
      const { names, sentences } = unseal();
      console.log(`unsealed ${names.length} excerpts (positions ${names.map((n) => n.slice(0, 2)).join(", ")}) into ${DIR}/`);
      console.log(`${SPANS}: ${sentences} sentence rows; open time in ${OPENED}`);
    },
    check, recall, sheet,
  };
  const run = commands[process.argv[2]];
  if (!run) {
    console.error("usage: node audit/heldout.ts (unseal | check | recall | sheet)");
    process.exit(2);
  }
  try {
    await run();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
