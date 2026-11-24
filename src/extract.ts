import {
  AFTER, AGED, ANY_UNIT, BEFORE, END, EVERY, NUMBER, ONCE, QUANTITY_UNIT, SEP, TIME_UNIT, TIMES, blankExcluded,
} from "./lexicon.ts";
import { detailKey } from "./normalize.ts";

export type Category = "limit" | "time" | "quantity";

export interface Span {
  text: string;
  start: number;
  end: number;
  category: Category;
}

// #3: a limit span keeps its time window ("no more than 4 tablets in 24 hours").
const WINDOW = `\\s+(?:in|per|every|each|within|a)\\s+(?:(?:an?|one)\\s+)?(?:${NUMBER}${SEP})?(?:${TIME_UNIT})${END}|\\s+daily\\b`;
const LIMIT = `(?:${BEFORE})(?:${WINDOW})?|${AFTER}`;

const AMOUNT = `${NUMBER}${SEP}(?:${QUANTITY_UNIT})${END}`;
// #1: a frequency joined to a quantity unit is one time span, and "N <unit> a day" takes any unit.
const FREQUENCY = `(?:${AMOUNT}\\s+)?(?:${ONCE}|${TIMES}|${EVERY})|${NUMBER}${SEP}(?:${ANY_UNIT})${END}\\s+(?:(?:a|per)\\s+day\\b|daily\\b)`;
const DURATION = `(?<!\\baged\\s+)${NUMBER}${SEP}(?:${TIME_UNIT})${END}(?![-\\s]+(?:old|of\\s+age)\\b)`;

// #1: a number is an age only next to "old", "of age" or "aged", and ages are quantities.
const AGE = `${NUMBER}${SEP}(?:${TIME_UNIT})${END}[-\\s]+(?:old|of\\s+age)\\b|${AGED}`;

const SPANS = new RegExp(
  `(?<limit>${LIMIT})|(?<time>${FREQUENCY}|${DURATION})|(?<quantity>${AGE}|${AMOUNT})`,
  "giu",
);
const CATEGORIES: Category[] = ["limit", "time", "quantity"];

export function extractSpans(text: string): Span[] {
  const seen = new Set<string>();
  const spans: Span[] = [];
  for (const m of blankExcluded(text).matchAll(SPANS)) {
    const category = CATEGORIES.find((name) => m.groups?.[name] !== undefined)!;
    const start = m.index;
    const end = start + m[0].length;
    const spanText = text.slice(start, end);
    // #3: a detail repeated in the same handout counts once.
    const id = `${category}|${detailKey(spanText)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    spans.push({ text: spanText, start, end, category });
  }
  return spans;
}
