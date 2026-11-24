import {
  ANY_UNIT, END, HEALTH_COUNT_UNITS, MEASURE_UNITS, NUMBER, ONES, SEP, SINGLE, TEENS, TENS, TIME_UNIT, TIME_UNITS, alt,
} from "./lexicon.ts";

export type Relation = ">=" | "<=" | ">" | "<";

export interface Measure {
  low: number;
  high: number;
  dim: string;
}

export interface Detail {
  relation: Relation | null;
  amount: Measure;
  times: number | null;
  per: Measure | null;
}

// Units in one dimension convert exactly; tablet, pill and capsule count as one unit, as do shot and injection.
const UNIT_INFO: Record<string, [dim: string, factor: number]> = {
  second: ["time", 1], minute: ["time", 60], hour: ["time", 3600], day: ["time", 86400], week: ["time", 604800],
  month: ["months", 1], year: ["months", 12],
  mcg: ["mass", 0.001], mg: ["mass", 1], g: ["mass", 1000], kg: ["mass", 1_000_000],
  oz: ["us mass", 1], lb: ["us mass", 16],
  mL: ["volume", 1], L: ["volume", 1000],
  tsp: ["us volume", 1], tbsp: ["us volume", 3], "fl oz": ["us volume", 6], cup: ["us volume", 48],
  "°F": ["°F", 1], "°C": ["°C", 1], degree: ["degree", 1],
  inch: ["us length", 1], foot: ["us length", 12], cm: ["cm", 1],
  IU: ["IU", 1], unit: ["unit", 1], calorie: ["calorie", 1], mmHg: ["mmHg", 1], "mg/dL": ["mg/dL", 1],
  dose: ["dose", 1], tablet: ["pill", 1], pill: ["pill", 1], capsule: ["pill", 1],
  shot: ["shot", 1], injection: ["shot", 1], serving: ["serving", 1], drink: ["drink", 1], puff: ["puff", 1], drop: ["drop", 1],
};

const key = (text: string) => text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();

const CANONICAL = new Map<string, string>();
for (const table of [TIME_UNITS, MEASURE_UNITS, HEALTH_COUNT_UNITS]) {
  for (const [name, list] of Object.entries(table)) for (const form of list) CANONICAL.set(key(form), name);
}

// The source side only ever contains the closed lists (#2); the extra phrases are simplified-side synonyms (#17).
export const LEADING: Record<Relation, string[]> = {
  ">=": ["at least", "no less than", "not less than", "no fewer than", "not fewer than", "no shorter than", "not shorter than",
    "a minimum of", "minimum of", "at minimum"],
  "<=": ["at most", "no more than", "not more than", "no longer than", "not longer than", "up to", "a maximum of", "maximum of",
    "at maximum", "do not exceed",
    "don't exceed", "don’t exceed", "not to exceed", "never more than", "within"],
  ">": ["more than", "over", "above", "longer than", "greater than", "older than"],
  "<": ["less than", "fewer than", "under", "below", "shorter than", "younger than"],
};
export const TRAILING: Record<Relation, string[]> = {
  ">=": ["or more", "or longer", "and older", "or older", "and up", "and over", "or above", "or higher", "or greater", "at least", "minimum"],
  "<=": ["or less", "or fewer", "or under", "or younger", "and under", "or shorter", "at most", "maximum", "max"],
  ">": [],
  "<": [],
};

const RELATION_OF = new Map<string, Relation>();
for (const table of [LEADING, TRAILING]) {
  for (const [relation, list] of Object.entries(table)) for (const phrase of list) RELATION_OF.set(key(phrase), relation as Relation);
}
export const LEADING_ALT = alt(Object.values(LEADING).flat());
export const TRAILING_ALT = alt(Object.values(TRAILING).flat());

const WORD_VALUES = new Map<string, number>([
  ...ONES.map((word, i): [string, number] => [word, i + 1]),
  ...TEENS.map((word, i): [string, number] => [word, i + 10]),
  ...TENS.map((word, i): [string, number] => [word, (i + 2) * 10]),
]);
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

export function numberValue(token: string): number | null {
  const text = token.trim().toLowerCase();
  let m = text.match(/^([a-z]+)(?:-([a-z]+))?$/);
  if (m) {
    const first = WORD_VALUES.get(m[1]);
    if (first === undefined || !m[2]) return first ?? null;
    const second = WORD_VALUES.get(m[2]);
    return first >= 20 && second !== undefined && second < 10 ? first + second : null;
  }
  if ((m = text.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if ((m = text.match(/^(\d+)\/(\d+)$/))) return Number(m[1]) / Number(m[2]);
  if ((m = text.match(/^(\d*)([½¼¾⅓⅔])$/))) return Number(m[1] || 0) + FRACTIONS[m[2]];
  if ((m = text.replace(/,/g, "").match(/^\d+(?:\.\d+)?$/))) return Number(m[0]);
  return null;
}

const SINGLE_ALL = new RegExp(SINGLE, "giu");

export function numberRange(text: string): [number, number] | null {
  const values = [...text.matchAll(SINGLE_ALL)].map((m) => numberValue(m[0]));
  if (!values.length || values.some((v) => v === null)) return null;
  return [values[0]!, values[values.length - 1]!];
}

export function measureOf(low: number, high: number, unitText: string): Measure | null {
  const canonical = CANONICAL.get(key(unitText));
  if (!canonical) return null;
  const [dim, factor] = UNIT_INFO[canonical];
  return { low: low * factor, high: high * factor, dim };
}

function measure(numberText: string, unitText: string): Measure | null {
  const range = numberRange(numberText);
  return range && measureOf(range[0], range[1], unitText);
}

const ADVERB_UNIT: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
const ADVERBS = "daily|weekly|monthly|yearly";

const LEAD_RE = new RegExp(`^(${LEADING_ALT})\\s+`, "iu");
const TRAIL_RE = new RegExp(`\\s+(${TRAILING_ALT})$`, "iu");
const AGED_RE = /^aged\s+/iu;
const AGE_MARK_RE = /[-\s]+(?:old|of\s+age)$/iu;
const AMOUNT_RE = new RegExp(`^(${NUMBER})${SEP}(${ANY_UNIT})${END}`, "iu");
const ARTICLE_RE = new RegExp(`^(an?|one|half\\s+an?)\\s+(${TIME_UNIT})${END}`, "iu");
const BARE_RE = new RegExp(`^(${NUMBER})$`, "iu");
const ONCE_RE = new RegExp(`^(once|twice)\\s+(?:(?:a|an|per|every|each)\\s+(${TIME_UNIT})${END}|(${ADVERBS})\\b)`, "iu");
const TIMES_RE = new RegExp(`^(${NUMBER})\\s+times?\\s+(?:(?:a|an|per|every|each)\\s+(${TIME_UNIT})${END}|(${ADVERBS})\\b)`, "iu");
const EVERY_RE = new RegExp(`^every\\s+(?:(${NUMBER})${SEP})?(${TIME_UNIT})${END}`, "iu");
const WINDOW_RE = new RegExp(
  `^(?:(?:in|per|a|an|each|every|within)\\s+(?:(?:an?|one)\\s+)?(?:(${NUMBER})${SEP})?(${TIME_UNIT})${END}|(${ADVERBS})\\b)`,
  "iu",
);

function period(numberText: string | undefined, unitText: string | undefined, adverb: string | undefined): Measure | null {
  if (adverb) return measureOf(1, 1, ADVERB_UNIT[adverb.toLowerCase()]);
  if (!unitText) return null;
  return numberText ? measure(numberText, unitText) : measureOf(1, 1, unitText);
}

export function parseDetail(raw: string): Detail | null {
  let text = raw.replace(/\s+/g, " ").trim();
  let relation: Relation | null = null;
  let m = text.match(LEAD_RE);
  if (m) {
    relation = RELATION_OF.get(key(m[1])) ?? null;
    text = text.slice(m[0].length);
  }
  if ((m = text.match(TRAIL_RE))) {
    relation ??= RELATION_OF.get(key(m[1])) ?? null;
    text = text.slice(0, m.index);
  }
  const aged = AGED_RE.test(text);
  text = text.replace(AGED_RE, "").replace(AGE_MARK_RE, "");

  let amount: Measure | null = null;
  if ((m = text.match(AMOUNT_RE))) {
    amount = measure(m[1], m[2]);
  } else if ((m = text.match(ARTICLE_RE))) {
    amount = measureOf(m[1].toLowerCase().startsWith("half") ? 0.5 : 1, m[1].toLowerCase().startsWith("half") ? 0.5 : 1, m[2]);
  } else if (aged && (m = text.match(BARE_RE))) {
    const range = numberRange(m[1]);
    amount = range && measureOf(range[0], range[1], "years");
  }
  if (m && amount) text = text.slice(m[0].length).trim();

  let times: number | null = null;
  let per: Measure | null = null;
  if ((m = text.match(ONCE_RE))) {
    const n = m[1].toLowerCase() === "once" ? 1 : 2;
    per = period(undefined, m[2], m[3]);
    if (amount) times = n;
    else amount = { low: n, high: n, dim: "times" };
  } else if ((m = text.match(TIMES_RE))) {
    const range = numberRange(m[1]);
    per = period(undefined, m[2], m[3]);
    if (range && amount) times = range[0];
    else if (range) amount = { low: range[0], high: range[1], dim: "times" };
  } else if ((m = text.match(EVERY_RE))) {
    per = period(m[1], m[2], undefined);
    if (amount) times = 1;
    else amount = { low: 1, high: 1, dim: "times" };
  } else if ((m = text.match(WINDOW_RE))) {
    per = period(m[1], m[2], m[3]);
  }
  return amount && { relation, amount, times, per };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function sameMeasure(a: Measure | null, b: Measure | null): boolean {
  if (!a || !b) return a === b;
  return a.dim === b.dim && near(a.low, b.low) && near(a.high, b.high);
}

export function detailKey(text: string): string {
  const detail = parseDetail(text);
  return detail ? JSON.stringify(detail) : key(text);
}
