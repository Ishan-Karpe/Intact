import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Category } from "../src/extract.ts";
import { ANY_UNIT, END, HEALTH_COUNT_UNITS, MEASURE_UNITS, NUMBER, SINGLE, TIME_UNITS } from "../src/lexicon.ts";
import { LEADING, LEADING_ALT, TRAILING, TRAILING_ALT, numberRange, numberValue, type Relation } from "../src/normalize.ts";
import { readRecords, toCsv } from "./csv.ts";
import { CATEGORIES } from "./rates.ts";

// A8, the seeded-loss test. Edits come only from the tables below, and the matcher runs only in `score`.
const SHEET = "data/labels/heldout_labels.csv";
const SOURCES = "data/heldout";
const OUTPUTS = "data/outputs/heldout";
const SEEDED = "data/outputs/heldout_seeded";
const EDITS = "data/heldout_seeded_edits.csv";
const RESULTS = "data/heldout_seeded_results.json";

export interface SheetRow {
  span_id: string;
  file: string;
  category: Category;
  label: string;
  matcher_outcome: string;
  matcher_text: string;
}
export type EditType = 1 | 2 | 3;
export interface Planned {
  row: SheetRow;
  role: "edited" | "control";
  type: EditType | null;
}
export interface Entry {
  span_id: string;
  file: string;
  category: Category;
  role: string;
  edit: string;
  expected: string;
  status: string;
  reason: string;
  before: string;
  after: string;
}
const COLUMNS: (keyof Entry)[] = ["span_id", "file", "category", "role", "edit", "expected", "status", "reason", "before", "after"];

const spanNumber = (id: string) => Number(id.slice(id.lastIndexOf("#") + 1));

export function plan(rows: SheetRow[]): Planned[] {
  const eligible = rows
    .filter((r) => r.matcher_outcome === "preserved" && r.label === "preserved")
    .sort((a, b) => (a.file === b.file ? spanNumber(a.span_id) - spanNumber(b.span_id) : a.file < b.file ? -1 : 1));
  const seen: Record<string, number> = {};
  const edited: Record<string, number> = {};
  return eligible.map((row) => {
    seen[row.category] = (seen[row.category] ?? 0) + 1;
    if (seen[row.category] % 2 === 0) return { row, role: "control", type: null };
    edited[row.category] = (edited[row.category] ?? 0) + 1;
    return { row, role: "edited", type: (((edited[row.category] - 1) % 3) + 1) as EditType };
  });
}

const NAMES = {
  limit: { 1: "remove the limit", 2: "flip the limit", 3: "delete the span" },
  other: { 1: "double the number", 2: "change the unit", 3: "delete the span" },
};
export const editName = (category: Category, type: EditType) => NAMES[category === "limit" ? "limit" : "other"][type];

const key = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const sameCase = (from: string, to: string) => (/^[A-Z]/.test(from) ? to[0].toUpperCase() + to.slice(1) : to);

function relations(table: Record<Relation, string[]>) {
  const map = new Map<string, Relation>();
  for (const [relation, list] of Object.entries(table)) for (const phrase of list) map.set(key(phrase), relation as Relation);
  return map;
}
const LEAD_RELATION = relations(LEADING);
const TRAIL_RELATION = relations(TRAILING);
const LEAD = new RegExp(`^(${LEADING_ALT})\\s+`, "iu");
const TRAIL = new RegExp(`\\s+(${TRAILING_ALT})$`, "iu");
const FLIP_LEADING: Record<Relation, string> = { ">=": "at most", "<=": "at least", ">": "less than", "<": "more than" };
const FLIP_TRAILING: Partial<Record<Relation, string>> = { ">=": "or less", "<=": "or more" };

function limitEdit(text: string, type: 1 | 2): string | null {
  const lead = text.match(LEAD);
  if (lead) {
    if (type === 1) return text.slice(lead[0].length);
    return sameCase(lead[1], FLIP_LEADING[LEAD_RELATION.get(key(lead[1]))!]) + text.slice(lead[1].length);
  }
  const trail = text.match(TRAIL);
  if (!trail) return null;
  if (type === 1) return text.slice(0, trail.index);
  const flipped = FLIP_TRAILING[TRAIL_RELATION.get(key(trail[1]))!];
  return flipped ? text.slice(0, text.length - trail[1].length) + flipped : null;
}

const FIRST_NUMBER = new RegExp(`(?<num>${NUMBER})|\\b(?<word>once|twice)\\b`, "iu");
const SINGLE_ALL = new RegExp(SINGLE, "giu");

function doubleNumber(text: string): string | null {
  const m = text.match(FIRST_NUMBER);
  if (!m?.groups) return null;
  let replacement: string;
  if (m.groups.word) {
    replacement = sameCase(m.groups.word, m.groups.word.toLowerCase() === "once" ? "twice" : "4 times");
  } else {
    let readable = true;
    replacement = m.groups.num.replace(SINGLE_ALL, (s) => {
      const value = numberValue(s);
      if (value === null) readable = false;
      return String(Math.round((value ?? 0) * 200) / 100);
    });
    if (!readable) return null;
  }
  return text.slice(0, m.index) + replacement + text.slice(m.index! + m[0].length);
}

const UNIT = new RegExp(`(?<!\\p{L})(?:${ANY_UNIT})${END}`, "iu");
const CANONICAL = new Map<string, string>();
for (const table of [TIME_UNITS, MEASURE_UNITS, HEALTH_COUNT_UNITS]) {
  for (const [name, list] of Object.entries(table)) for (const form of list) CANONICAL.set(key(form), name);
}
const NEXT_UNIT: Record<string, string> = {
  second: "minute", minute: "hour", hour: "day", day: "week", week: "month", month: "year", year: "month",
  mcg: "mg", mg: "g", g: "kg", kg: "g", mL: "L", L: "mL", tsp: "tbsp", tbsp: "cup", cup: "tbsp", oz: "lb", lb: "oz",
  inch: "foot", foot: "inch", cm: "inch", "°F": "°C", "°C": "°F",
  tablet: "dose", pill: "dose", capsule: "dose", shot: "dose", injection: "dose", puff: "dose", drop: "dose", dose: "tablet",
};
const SPELLING: Record<string, [singular: string, plural: string]> = {
  minute: ["minute", "minutes"], hour: ["hour", "hours"], day: ["day", "days"], week: ["week", "weeks"],
  month: ["month", "months"], year: ["year", "years"],
  mg: ["mg", "mg"], g: ["g", "g"], kg: ["kg", "kg"], mL: ["mL", "mL"], L: ["L", "L"],
  tbsp: ["tablespoon", "tablespoons"], cup: ["cup", "cups"], oz: ["ounce", "ounces"], lb: ["pound", "pounds"],
  inch: ["inch", "inches"], foot: ["foot", "feet"], "°C": ["°C", "°C"], "°F": ["°F", "°F"],
  dose: ["dose", "doses"], tablet: ["tablet", "tablets"],
};

function isPlural(form: string, text: string): boolean {
  if (/[aeiou]/i.test(form)) return /s$/i.test(form) || /^feet$/i.test(form);
  const n = text.match(new RegExp(NUMBER, "iu"));
  const range = n ? numberRange(n[0]) : null;
  return range !== null && range[1] > 1;
}

function changeUnit(text: string): string | null {
  const m = text.match(UNIT);
  const target = m && NEXT_UNIT[CANONICAL.get(key(m[0])) ?? ""];
  if (!m || !target) return null;
  return text.slice(0, m.index) + SPELLING[target][isPlural(m[0], text) ? 1 : 0] + text.slice(m.index! + m[0].length);
}

// "" means delete the span.
export function editText(category: Category, type: EditType, text: string): string | null {
  if (type === 3) return "";
  if (category === "limit") return limitEdit(text, type);
  return type === 1 ? doubleNumber(text) : changeUnit(text);
}

function occurrences(text: string, needle: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) at.push(i);
  return at;
}

export function seedFile(raw: string, sheet: SheetRow[], planned: Planned[]) {
  const entries: Entry[] = [];
  const edits: { start: number; end: number; after: string }[] = [];
  for (const { row, role, type } of planned) {
    const entry: Entry = {
      span_id: row.span_id, file: row.file, category: row.category, role,
      edit: "", expected: "", status: "control", reason: "", before: "", after: "",
    };
    entries.push(entry);
    if (role === "control" || type === null) continue;
    Object.assign(entry, { edit: editName(row.category, type), expected: type === 3 ? "omitted" : "altered", status: "skipped", before: row.matcher_text });
    const hits = occurrences(raw, row.matcher_text);
    if (hits.length !== 1) {
      entry.reason = hits.length ? `matched text appears ${hits.length} times` : "matched text not found in the raw output";
      continue;
    }
    const start = hits[0];
    const end = start + row.matcher_text.length;
    const overlaps = sheet.some((o) => o.span_id !== row.span_id && o.file === row.file && o.matcher_text &&
      occurrences(raw, o.matcher_text).some((at) => at < end && start < at + o.matcher_text.length));
    if (overlaps) {
      entry.reason = "overlaps another span's matched text";
      continue;
    }
    const after = editText(row.category, type, row.matcher_text);
    if (after === null || after === row.matcher_text) {
      entry.reason = "no replacement in the A8 tables";
      continue;
    }
    Object.assign(entry, { status: "edited", after });
    edits.push({ start, end, after });
  }
  let text = raw;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    let { start, end } = edit;
    if (edit.after === "") {
      if (text[end] === " ") end++;
      else if (text[start - 1] === " ") start--;
    }
    text = text.slice(0, start) + edit.after + text.slice(end);
  }
  return { text, entries };
}

const isLoss = (o: string | undefined) => o === "omitted" || o === "altered";

export function scoreSeeded(entries: Entry[], outcomes: Map<string, string>) {
  const tally = (list: Entry[]) => {
    const out = list.map((e) => outcomes.get(e.span_id));
    const caught = out.filter(isLoss).length;
    const uncertain = out.filter((o) => o === "uncertain").length;
    return { n: list.length, caught, uncertain, flagged: caught + uncertain, preserved: out.filter((o) => o === "preserved").length };
  };
  const edited = entries.filter((e) => e.status === "edited");
  const controls = entries.filter((e) => e.status === "control");
  const skipped = entries.filter((e) => e.status === "skipped");
  const control = (list: Entry[]) => {
    const t = tally(list);
    return { n: t.n, falseAlarms: t.caught, uncertain: t.uncertain, preserved: t.preserved };
  };
  const byEdit: Record<string, ReturnType<typeof tally>> = {};
  for (const c of CATEGORIES) {
    for (const name of [...new Set(edited.filter((e) => e.category === c).map((e) => e.edit))]) {
      byEdit[`${c}: ${name}`] = tally(edited.filter((e) => e.category === c && e.edit === name));
    }
  }
  const reasons: Record<string, number> = {};
  for (const e of skipped) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
  return {
    edited: { ...tally(edited), typeMatch: edited.filter((e) => outcomes.get(e.span_id) === e.expected).length },
    controls: control(controls),
    skipped: { n: skipped.length, reasons },
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, {
      edited: tally(edited.filter((e) => e.category === c)),
      controls: control(controls.filter((e) => e.category === c)),
    }])),
    byEdit,
  };
}

function seed() {
  if (existsSync(SEEDED) || existsSync(EDITS)) throw new Error(`${SEEDED} or ${EDITS} already exists; seed runs once`);
  const sheet = readRecords(readFileSync(SHEET, "utf8")) as unknown as SheetRow[];
  const planned = plan(sheet);
  mkdirSync(SEEDED, { recursive: true });
  const entries: Entry[] = [];
  for (const file of readdirSync(OUTPUTS).filter((f) => f.endsWith(".md")).sort()) {
    const name = file.replace(/\.md$/, "");
    const result = seedFile(readFileSync(join(OUTPUTS, file), "utf8"), sheet.filter((r) => r.file === name), planned.filter((p) => p.row.file === name));
    writeFileSync(join(SEEDED, file), result.text);
    entries.push(...result.entries);
  }
  writeFileSync(EDITS, toCsv([COLUMNS, ...entries.map((e) => COLUMNS.map((c) => e[c]))]));
  const count = (status: string, c?: Category) => entries.filter((e) => e.status === status && (!c || e.category === c)).length;
  console.log(`${EDITS}: ${count("edited")} edited, ${count("skipped")} skipped, ${count("control")} controls; ${sheet.length - planned.length} left out`);
  for (const c of CATEGORIES) console.log(`  ${c}: ${count("edited", c)} edited, ${count("skipped", c)} skipped, ${count("control", c)} controls`);
  const reasons: Record<string, number> = {};
  for (const e of entries.filter((e) => e.status === "skipped")) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
  for (const [reason, n] of Object.entries(reasons)) console.log(`  skipped, ${reason}: ${n}`);
  console.log(`wrote ${readdirSync(SEEDED).length} copies to ${SEEDED}/`);
}

async function score() {
  if (existsSync(RESULTS)) throw new Error(`${RESULTS} already exists; score runs once`);
  const { compare } = await import("../src/match.ts");
  const sheet = readRecords(readFileSync(SHEET, "utf8")) as unknown as SheetRow[];
  const byId = new Map(sheet.map((r) => [r.span_id, r]));
  const entries = readRecords(readFileSync(EDITS, "utf8")) as unknown as Entry[];
  const outcomes = new Map<string, string>();
  const reasons = new Map<string, string>();
  let reproduced = 0;
  for (const file of readdirSync(SEEDED).filter((f) => f.endsWith(".md")).sort()) {
    const name = file.replace(/\.md$/, "");
    const source = readFileSync(join(SOURCES, `${name}.txt`), "utf8");
    compare(source, readFileSync(join(SEEDED, file), "utf8")).forEach((r, i) => {
      outcomes.set(`${name}#${i + 1}`, r.outcome);
      reasons.set(`${name}#${i + 1}`, r.reason);
    });
    // The untouched outputs must still give the committed readings.
    compare(source, readFileSync(join(OUTPUTS, file), "utf8")).forEach((r, i) => {
      if (byId.get(`${name}#${i + 1}`)?.matcher_outcome === r.outcome) reproduced++;
    });
  }
  const report = {
    ...scoreSeeded(entries, outcomes),
    leftOut: sheet.length - entries.length,
    originalsReproduced: `${reproduced} of ${sheet.length}`,
    rows: entries.map((e) => ({ span_id: e.span_id, category: e.category, status: e.status, edit: e.edit, expected: e.expected, outcome: outcomes.get(e.span_id), reason: reasons.get(e.span_id) })),
  };
  writeFileSync(RESULTS, JSON.stringify(report, null, 2) + "\n");
  const { edited, controls, skipped } = report;
  console.log(`edited ${edited.n}: caught ${edited.caught} (type match ${edited.typeMatch}), uncertain ${edited.uncertain}, flagged ${edited.flagged}, read as preserved ${edited.preserved}`);
  console.log(`controls ${controls.n}: false alarms ${controls.falseAlarms}, uncertain ${controls.uncertain}, preserved ${controls.preserved}`);
  console.log(`skipped ${skipped.n}, left out ${report.leftOut}, untouched outputs reproduce the sheet: ${report.originalsReproduced}`);
  console.log(`wrote ${RESULTS}`);
}

if (import.meta.main) {
  const commands: Record<string, () => unknown> = { seed, score };
  const run = commands[process.argv[2]];
  if (!run) {
    console.error("usage: node audit/seed.ts (seed | score)");
    process.exit(2);
  }
  try {
    await run();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
