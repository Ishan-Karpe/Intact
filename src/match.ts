import { extractSpans, type Span } from "./extract.ts";
import { ANY_UNIT, END, NUMBER, SEP, TIME_UNIT, blankExcluded } from "./lexicon.ts";
import { stripMarkdown } from "./markdown.ts";
import { LEADING_ALT, TRAILING_ALT, measureOf, parseDetail, sameMeasure, type Detail, type Relation } from "./normalize.ts";

export type Outcome = "preserved" | "omitted" | "altered" | "uncertain";

export interface Result {
  span: Span;
  outcome: Outcome;
  reason: string;
  evidence: string | null;
}

interface Mention {
  text: string;
  detail: Detail;
}

// Simplified side only: synonyms, "an hour", "half an hour" and "3 times daily" are allowed here (#17).
const ADVERBS = "daily|weekly|monthly|yearly";
const AMOUNT = `${NUMBER}${SEP}(?:${ANY_UNIT})${END}`;
const ARTICLE = `\\b(?:an?|one|half\\s+an?)\\s+(?:${TIME_UNIT})${END}`;
const ONCE = `\\b(?:once|twice)\\s+(?:(?:a|an|per|every|each)\\s+(?:${TIME_UNIT})${END}|(?:${ADVERBS})\\b)`;
const TIMES = `${NUMBER}\\s+times?\\s+(?:(?:a|an|per|every|each)\\s+(?:${TIME_UNIT})${END}|(?:${ADVERBS})\\b)`;
const EVERY = `\\bevery\\s+(?:${NUMBER}${SEP})?(?:${TIME_UNIT})${END}`;
const WINDOW = `\\s+(?:in|per|every|each|within|a|an)\\s+(?:(?:an?|one)\\s+)?(?:${NUMBER}${SEP})?(?:${TIME_UNIT})${END}|\\s+(?:${ADVERBS})\\b`;
const AGE = `(?:[-\\s]+(?:old|of\\s+age)\\b)?`;
const CORE = `(?:${AMOUNT}${AGE}\\s+)?(?:${ONCE}|${TIMES}|${EVERY})|${AMOUNT}${AGE}|\\baged\\s+${NUMBER}|${ARTICLE}`;
const MENTION = new RegExp(
  `(?:\\b(?:${LEADING_ALT})\\s+)?(?:${CORE})(?:${WINDOW})?(?:\\s+(?:${TRAILING_ALT})\\b)?`,
  "giu",
);
const VAGUE = new RegExp(`\\b(?:a\\s+few|several|some|a\\s+couple(?:\\s+of)?|many|a\\s+little|a\\s+bit\\s+of)\\s+(?:more\\s+)?(${ANY_UNIT})${END}`, "giu");

// "Do not take more than 4" means at most 4, so a negation just before a limit flips it.
const NEGATED = /\b(?:do\s+not|don['’]t|does\s+not|doesn['’]t|never|should\s+not|shouldn['’]t|must\s+not|cannot|can['’]t|not)\s+(?:[\p{L}'’-]+\s+){0,2}$/iu;
const FLIP: Record<Relation, Relation> = { ">": "<=", ">=": "<", "<": ">=", "<=": ">" };

function inContext(detail: Detail, text: string, start: number): Detail {
  if (!detail.relation) return detail;
  const before = text.slice(0, start).split(/[.!?\n]/).pop() ?? "";
  return NEGATED.test(before) ? { ...detail, relation: FLIP[detail.relation] } : detail;
}

// A source span has only closed-list limit words (#2), but "longer than 2 weeks" still reads as a limit when matching.
const LEAD_BEFORE = new RegExp(`(?:^|\\s)(${LEADING_ALT})\\s+$`, "iu");
const TRAIL_AFTER = new RegExp(`^\\s+(${TRAILING_ALT})\\b`, "iu");

function sourceInContext(detail: Detail, text: string, span: Span): Detail {
  if (detail.relation) return inContext(detail, text, span.start);
  const before = text.slice(0, span.start);
  const lead = before.match(LEAD_BEFORE);
  if (lead) {
    const phraseStart = span.start - lead[0].length + lead[0].indexOf(lead[1]);
    return inContext({ ...detail, relation: parseDetail(`${lead[1]} ${span.text}`)?.relation ?? null }, text, phraseStart);
  }
  const trail = text.slice(span.end).match(TRAIL_AFTER);
  if (trail) return inContext({ ...detail, relation: parseDetail(`${span.text} ${trail[1]}`)?.relation ?? null }, text, span.start);
  return detail;
}

function mentions(text: string): Mention[] {
  const found: Mention[] = [];
  for (const m of blankExcluded(text).matchAll(MENTION)) {
    const detail = parseDetail(m[0]);
    if (detail) found.push({ text: text.slice(m.index, m.index + m[0].length), detail: inContext(detail, text, m.index) });
  }
  return found;
}

const direction = (r: Relation) => (r === ">=" || r === ">" ? "up" : "down");

function vagueDims(text: string): Set<string> {
  const dims = new Set<string>();
  for (const m of text.matchAll(VAGUE)) {
    const measure = measureOf(1, 1, m[1]);
    if (measure) dims.add(measure.dim);
  }
  return dims;
}

function decide(source: Detail, found: Mention[], vague: Set<string>): Omit<Result, "span"> {
  const same = found.filter((m) => sameMeasure(m.detail.amount, source.amount) && m.detail.times === source.times);
  const exact = same.find((m) => m.detail.relation === source.relation && sameMeasure(m.detail.per, source.per));
  if (exact) return { outcome: "preserved", reason: "same amount, limit and time window", evidence: exact.text };

  if (same.length) {
    const closest = same.find((m) => sameMeasure(m.detail.per, source.per)) ?? same[0];
    const other = closest.detail;
    if (other.relation !== source.relation) {
      if (source.relation && !other.relation) return { outcome: "altered", reason: "limit word dropped", evidence: closest.text };
      if (!source.relation && other.relation) return { outcome: "altered", reason: "limit word added", evidence: closest.text };
      if (direction(source.relation!) === direction(other.relation!)) {
        return { outcome: "uncertain", reason: "limit changed between inclusive and strict", evidence: closest.text };
      }
      return { outcome: "altered", reason: "limit reversed", evidence: closest.text };
    }
    if (source.per && !other.per) {
      const windowElsewhere = found.some((m) => sameMeasure(m.detail.amount, source.per));
      return windowElsewhere
        ? { outcome: "uncertain", reason: "time window may be stated separately", evidence: closest.text }
        : { outcome: "altered", reason: "time window dropped", evidence: closest.text };
    }
    return { outcome: "altered", reason: "time window changed", evidence: closest.text };
  }

  const sameDim = found.find((m) => m.detail.amount.dim === source.amount.dim);
  if (sameDim) return { outcome: "uncertain", reason: "a different amount of the same kind appears", evidence: sameDim.text };
  if (vague.has(source.amount.dim)) return { outcome: "uncertain", reason: "only a vague amount appears", evidence: null };
  return { outcome: "omitted", reason: "not identified in the simplified text", evidence: null };
}

export function compare(original: string, simplified: string): Result[] {
  const text = stripMarkdown(simplified);
  const found = mentions(text);
  const vague = vagueDims(text);
  return extractSpans(original).map((span) => {
    const detail = parseDetail(span.text);
    if (!detail) return { span, outcome: "uncertain", reason: "could not read the source detail", evidence: null };
    return { span, ...decide(sourceInContext(detail, original, span), found, vague) };
  });
}
