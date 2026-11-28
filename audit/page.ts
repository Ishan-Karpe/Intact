import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HEALTH_COUNT_UNITS, LIMIT_AFTER, LIMIT_BEFORE, MEASURE_UNITS, TIME_UNITS } from "../src/lexicon.ts";
import { readRecords } from "./csv.ts";

export const PAGES = ["web/index.html", "web/methods.html"];

interface Tally {
  n: number;
  caught: number;
  uncertain: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const quoted = (xs: string[]) => xs.map((x) => `“${x}”`).join(", ");

// Every number on the pages comes from the committed score files, never retyped.
export function pageNumbers(root = ".") {
  const json = (path: string) => JSON.parse(readFileSync(join(root, "data", path), "utf8"));
  const calibration = json("predictions.json");
  const heldout = json("heldout_scores.json");
  const recall = json("heldout_recall.json");
  const seeded = json("heldout_seeded_results.json");
  const labels = readRecords(readFileSync(join(root, "data", "labels", "heldout_labels.csv"), "utf8"));

  const categories = [calibration, heldout].flatMap((s) => Object.values(s.categories) as { spans: number; omitted: number; altered: number }[]);
  const flags = labels.filter((r) => r.matcher_outcome === "omitted" || r.matcher_outcome === "altered");
  const edits = Object.entries(seeded.byEdit as Record<string, Tally>);
  const pick = (pattern: RegExp) => edits.filter(([name]) => pattern.test(name)).map(([, tally]) => tally);
  const limitEdits = pick(/^limit: (?:remove|flip) the limit$/);
  const numberEdits = pick(/: (?:double the number|change the unit)$/);
  const deleteEdits = pick(/: delete the span$/);
  const perHandout = Object.values(heldout.perHandout as Record<string, Record<string, number>>)
    .map((c) => sum(Object.values(c)))
    .sort((a, b) => b - a);

  return {
    calibrationHandouts: Object.keys(calibration.perHandout).length,
    heldoutHandouts: Object.keys(heldout.perHandout).length,
    tracked: sum(categories.map((c) => c.spans)),
    trackedChanged: sum(categories.map((c) => c.omitted + c.altered)),
    marked: recall.marked,
    found: recall.found,
    missed: recall.misses.length,
    missedLimits: recall.misses.filter((m: { category: string }) => m.category === "limit").length,
    realFlags: flags.length,
    realFalseAlarms: flags.filter((r) => r.label === "preserved").length,
    realUnclear: labels.filter((r) => r.matcher_outcome === "uncertain" && r.label === "preserved").length,
    seededEdits: seeded.edited.n,
    seededCaught: seeded.edited.caught,
    seededUnclear: seeded.edited.uncertain,
    seededFound: seeded.edited.preserved,
    controls: seeded.controls.n,
    controlAlarms: seeded.controls.falseAlarms,
    limitEdits: sum(limitEdits.map((t) => t.n)),
    limitEditsCaught: sum(limitEdits.map((t) => t.caught)),
    numberEdits: sum(numberEdits.map((t) => t.n)),
    numberEditsCaught: sum(numberEdits.map((t) => t.caught)),
    numberEditsUnclear: sum(numberEdits.map((t) => t.uncertain)),
    deleteEdits: sum(deleteEdits.map((t) => t.n)),
    deleteEditsCaught: sum(deleteEdits.map((t) => t.caught)),
    deleteEditsUnclear: sum(deleteEdits.map((t) => t.uncertain)),
    heldoutDetails: sum(perHandout),
    clusterDetails: perHandout[0] + perHandout[1],
    limitBefore: quoted(LIMIT_BEFORE),
    limitAfter: quoted(LIMIT_AFTER),
    timeUnits: quoted(Object.keys(TIME_UNITS)),
    measureUnits: quoted(Object.keys(MEASURE_UNITS)),
    countUnits: quoted(Object.keys(HEALTH_COUNT_UNITS)),
  };
}

export type Numbers = ReturnType<typeof pageNumbers>;

// Sentences on the pages that stop being true if a score file changes.
export function brokenClaims(n: Numbers): string[] {
  const claims: [boolean, string][] = [
    [n.trackedChanged === 0, "methods: none of the tracked details was omitted or altered"],
    [n.missed === n.missedLimits, "methods: every detail the extractor missed was a limit"],
    [n.seededCaught + n.seededUnclear === n.seededEdits, "index and methods: the seeded changes not caught all read as couldn't tell"],
    [n.seededFound === 0, "methods: none of the seeded changes read as found"],
    [n.limitEdits + n.numberEdits + n.deleteEdits === n.seededEdits, "methods: the by-type breakdown covers every seeded change"],
    [n.limitEditsCaught === n.limitEdits, "methods: Intact caught every limit we removed or reversed"],
    [n.numberEditsCaught + n.numberEditsUnclear === n.numberEdits, "methods: the changed numbers and units not caught read as couldn't tell"],
    [n.numberEditsCaught === 1, "methods: one changed number was caught"],
    [n.deleteEditsCaught + n.deleteEditsUnclear === n.deleteEdits, "methods: the deleted details not caught read as couldn't tell"],
  ];
  return claims.filter(([holds]) => !holds).map(([, claim]) => claim);
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function fillNumbers(html: string, numbers: Numbers): string {
  return html.replace(/(<span data-n="(\w+)">)[^<]*(<\/span>)/g, (_, open: string, key: string, close: string) => {
    if (!(key in numbers)) throw new Error(`no number named ${key}`);
    return open + escape(String(numbers[key as keyof Numbers])) + close;
  });
}

if (import.meta.main) {
  const numbers = pageNumbers();
  const broken = brokenClaims(numbers);
  if (broken.length) {
    console.error(`These sentences no longer match the score files; reword them first:\n  ${broken.join("\n  ")}`);
    process.exit(1);
  }
  const check = process.argv[2] === "--check";
  let stale = 0;
  for (const page of PAGES) {
    const html = readFileSync(page, "utf8");
    const filled = fillNumbers(html, numbers);
    if (filled === html) continue;
    stale++;
    if (!check) writeFileSync(page, filled);
    console.log(`${check ? "out of date" : "updated"}: ${page}`);
  }
  if (check && stale) process.exit(1);
  if (!stale) console.log("pages match the score files");
}
