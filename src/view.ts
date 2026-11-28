import { findSpans, type Category, type Span } from "./extract.ts";
import { stripMarkdown } from "./markdown.ts";
import { compare, type Outcome, type Result } from "./match.ts";
import { LEADING_ALT, TRAILING_ALT, detailKey, parseDetail } from "./normalize.ts";
import { readabilityChange } from "./readability.ts";
import { similarity } from "./similarity.ts";

export type Reading = "found" | "change" | "unclear";

export const READING: Record<Outcome, Reading> = { preserved: "found", omitted: "change", altered: "change", uncertain: "unclear" };

// Uncertain must never look like a pass: in the seeded test, 5 of 6 changed numbers and units read that way.
export const WORDS: Record<Reading, string> = {
  found: "Same detail found",
  change: "Possible change, check this",
  unclear: "Couldn't tell, check this",
};

export const KIND: Record<Category, string> = { limit: "Limit", time: "Time", quantity: "Amount" };

const RANK: Reading[] = ["found", "unclear", "change"];

export interface Segment {
  text: string;
  marks: number[];
  reading: Reading | null;
}

export interface View {
  results: Result[];
  readings: Reading[];
  quotes: { original: string; simplified: string | null }[];
  read: string;
  original: Segment[];
  simplified: Segment[];
  counts: Record<Reading, number>;
  level: string;
  shared: string;
}

interface Range {
  start: number;
  end: number;
  i: number;
}

// Splits text into runs that carry the same results; a run shows the most serious reading among them.
export function segments(text: string, ranges: Range[], readings: Reading[]): Segment[] {
  const marks: number[][] = Array.from({ length: text.length }, () => []);
  for (const { start, end, i } of ranges) for (let c = start; c < end; c++) if (!marks[c].includes(i)) marks[c].push(i);
  const out: Segment[] = [];
  let start = 0;
  for (let c = 1; c <= text.length; c++) {
    if (c < text.length && marks[c].join() === marks[start].join()) continue;
    const here = marks[start].sort((a, b) => a - b);
    const reading = here.length ? RANK[Math.max(...here.map((i) => RANK.indexOf(readings[i])))] : null;
    out.push({ text: text.slice(start, c), marks: here, reading });
    start = c;
  }
  return out;
}

// Whole-detail matches only, so "2 hours" doesn't light up inside "12 hours" or "1/2 hours".
export function occurrences(text: string, needle: string): [number, number][] {
  const found: [number, number][] = [];
  if (!needle) return found;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + needle.length] ?? "";
    if (!/[\p{L}\p{N}/.]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) found.push([at, at + needle.length]);
  }
  return found;
}

// Copies of the context rules in match.ts, which is frozen, so they can't drift. A card that dropped "Do not"
// or "longer than" would make a correct reading look wrong.
const NEGATED = /\b(?:do\s+not|don['’]t|does\s+not|doesn['’]t|never|should\s+not|shouldn['’]t|must\s+not|cannot|can['’]t|not)\s+(?:[\p{L}'’-]+\s+){0,2}$/iu;
const LEAD_BEFORE = new RegExp(`(?:^|\\s)(${LEADING_ALT})\\s+$`, "iu");
const TRAIL_AFTER = new RegExp(`^\\s+(${TRAILING_ALT})\\b`, "iu");

function negationStart(text: string, start: number): number {
  const before = text.slice(0, start).split(/[.!?\n]/).pop() ?? "";
  const negation = before.match(NEGATED);
  return negation ? start - before.length + negation.index! : start;
}

// The original as sourceInContext reads it: a limit word just outside the span, then a negation before the limit.
export function sourceRange(text: string, span: Span): [number, number] {
  let { start, end } = span;
  let relation = parseDetail(span.text)?.relation ?? null;
  if (!relation) {
    const lead = text.slice(0, start).match(LEAD_BEFORE);
    const trail = lead ? null : text.slice(end).match(TRAIL_AFTER);
    if (lead) {
      relation = parseDetail(`${lead[1]} ${span.text}`)?.relation ?? null;
      if (relation) start -= lead[0].length - lead[0].indexOf(lead[1]);
    } else if (trail) {
      relation = parseDetail(`${span.text} ${trail[1]}`)?.relation ?? null;
      if (relation) end += trail[0].length;
    }
  }
  return [relation ? negationStart(text, start) : start, end];
}

// The simplified text as mentions() reads it: a negation before a limit.
export function evidenceRanges(read: string, evidence: string): [number, number][] {
  const relation = parseDetail(evidence)?.relation;
  return occurrences(read, evidence).map(([start, end]) => [relation ? negationStart(read, start) : start, end]);
}

export function readingLevel(change: number | null): string {
  if (change === null) return "Not enough text to estimate";
  if (Math.abs(change) < 1) return "About the same reading level";
  const grades = Math.round(Math.abs(change));
  return `About ${grades} grade${grades === 1 ? "" : "s"} ${change < 0 ? "easier" : "harder"} to read`;
}

export function view(original: string, simplified: string): View {
  const results = compare(original, simplified);
  const readings = results.map((r) => READING[r.outcome]);
  const read = stripMarkdown(simplified);

  // A detail repeated in the original is one result, so every repeat points back to it.
  const key = (category: Category, text: string) => `${category}|${detailKey(text)}`;
  const index = new Map(results.map((r, i) => [key(r.span.category, r.span.text), i]));
  const sourceRanges = findSpans(original).flatMap((span) => {
    const i = index.get(key(span.category, span.text));
    if (i === undefined) return [];
    const [start, end] = sourceRange(original, span);
    return [{ start, end, i }];
  });
  const evidence = results.map((r) => (r.evidence ? evidenceRanges(read, r.evidence) : []));
  const readRanges = evidence.flatMap((ranges, i) => ranges.map(([start, end]) => ({ start, end, i })));
  const quotes = results.map((r, i) => ({
    original: original.slice(...sourceRange(original, r.span)),
    simplified: evidence[i].length ? read.slice(...evidence[i][0]) : r.evidence,
  }));

  const counts: Record<Reading, number> = { found: 0, change: 0, unclear: 0 };
  for (const reading of readings) counts[reading]++;

  return {
    results,
    readings,
    quotes,
    read,
    original: segments(original, sourceRanges, readings),
    simplified: segments(read, readRanges, readings),
    counts,
    level: readingLevel(readabilityChange(original, simplified)),
    shared: `${Math.round(similarity(original, simplified) * 100)}%`,
  };
}
