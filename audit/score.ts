import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { findSpans, type Category } from "../src/extract.ts";
import { readRecords } from "./csv.ts";
import { readSources } from "./predict.ts";
import { CATEGORIES, stats, validate, type Label, type LabelRow } from "./rates.ts";

export interface SpanPrediction {
  predictor: number | null;
  baseline: number | null;
}

export interface CalibrationA4 {
  handout: string;
  category: Category;
  categoryRateWithout: number | null;
  baselineWithout: number | null;
}

export interface HandMark {
  file: string;
  text: string;
  occurrence: number;
  category: Category;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-12;
const lost = (label: Label) => (label === "omitted" || label === "altered" ? 1 : 0);

export function brier(pairs: [p: number, y: number][]): number | null {
  if (!pairs.length) return null;
  return pairs.reduce((sum, [p, y]) => sum + (p - y) ** 2, 0) / pairs.length;
}

interface Scored {
  row: LabelRow;
  p: number;
  b: number;
  y: number;
}

// #5 and #19: uncertain spans and spans without a prediction stay out of both scores.
function scoredRows(rows: LabelRow[], predictions: Record<string, SpanPrediction>): Scored[] {
  return rows.flatMap((row) => {
    const { predictor, baseline } = predictions[row.span_id];
    if (row.label === "uncertain" || predictor === null || baseline === null) return [];
    return [{ row, p: predictor, b: baseline, y: lost(row.label) }];
  });
}

function compareScores(scored: Scored[]) {
  const predictor = brier(scored.map((s) => [s.p, s.y]));
  const baseline = brier(scored.map((s) => [s.b, s.y]));
  // A6: identical predictions on every scored span make the test not testable.
  const notTestable = scored.length === 0 || scored.every((s) => same(s.p, s.b));
  const beatsBaseline = notTestable ? "not testable" : predictor! < baseline! ? "yes" : "no";
  return { scored: scored.length, brierPredictor: predictor, brierBaseline: baseline, beatsBaseline };
}

export function scoreHeldout(rows: LabelRow[], predictions: Record<string, SpanPrediction>, calibrationA4: CalibrationA4[] = []) {
  const missing = rows.filter((r) => !(r.span_id in predictions)).map((r) => r.span_id);
  if (missing.length) throw new Error(`no committed prediction for: ${missing.join(", ")}`);

  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, stats(rows.filter((r) => r.category === c))]));
  const perHandout: Record<string, Record<Category, number>> = {};
  for (const r of rows) {
    perHandout[r.file] ??= { limit: 0, time: 0, quantity: 0 };
    perHandout[r.file][r.category]++;
  }
  const scored = scoredRows(rows, predictions);
  const result = compareScores(scored);

  // A4, held-out side: a handout supplying more than half of a category's spans.
  const heldoutA4 = [];
  for (const c of CATEGORIES) {
    const total = rows.filter((r) => r.category === c).length;
    for (const [file, counts] of Object.entries(perHandout)) {
      if (total && counts[c] / total > 0.5) {
        heldoutA4.push({
          handout: file, category: c, share: `${counts[c]} of ${total}`,
          lossRateWithout: stats(rows.filter((r) => r.category === c && r.file !== file)).rate,
          ...compareScores(scored.filter((s) => s.row.file !== file)),
        });
      }
    }
  }

  // A4, calibration side: rates recomputed without the dominant calibration handout.
  const calibrationSide = calibrationA4.map((a) => ({
    handout: a.handout,
    category: a.category,
    ...compareScores(scored.map((s) => ({
      ...s,
      p: s.row.category === a.category && a.categoryRateWithout !== null ? a.categoryRateWithout : s.p,
      b: a.baselineWithout ?? s.b,
    }))),
  }));

  return { categories, perHandout, ...result, a4: { heldout: heldoutA4, calibration: calibrationSide } };
}

function locate(source: string, text: string, occurrence: number): [number, number] | null {
  let from = 0;
  for (let n = 1; ; n++) {
    const at = source.indexOf(text, from);
    if (at === -1) return null;
    if (n === occurrence) return [at, at + text.length];
    from = at + 1;
  }
}

// #15: a hand-marked span counts as found if an extractor span overlaps it; category agreement is reported separately.
export function extractorRecall(marks: HandMark[], sources: Record<string, string>) {
  const misses: HandMark[] = [];
  const notLocated: HandMark[] = [];
  let found = 0;
  let categoryAgrees = 0;
  for (const mark of marks) {
    const range = locate(sources[mark.file] ?? "", mark.text, mark.occurrence || 1);
    if (!range) {
      notLocated.push(mark);
      continue;
    }
    const overlapping = findSpans(sources[mark.file]).filter((s) => s.start < range[1] && range[0] < s.end);
    if (!overlapping.length) {
      misses.push(mark);
      continue;
    }
    found++;
    if (overlapping.some((s) => s.category === mark.category)) categoryAgrees++;
  }
  const located = marks.length - notLocated.length;
  return { marked: marks.length, located, found, recall: located ? found / located : null, categoryAgrees, misses, notLocated };
}

function main() {
  const { values } = parseArgs({
    options: {
      labels: { type: "string" }, predictions: { type: "string" }, calibration: { type: "string" },
      "hand-marks": { type: "string" }, sealed: { type: "string" }, out: { type: "string" },
    },
  });
  for (const key of ["labels", "predictions", "calibration", "hand-marks", "sealed", "out"] as const) {
    if (!values[key]) {
      console.error(`missing --${key}`);
      process.exit(2);
    }
  }
  const rows = readRecords(readFileSync(values.labels!, "utf8")) as unknown as LabelRow[];
  const problems = validate(rows);
  if (problems.length) {
    console.error(`Fix the labels first:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  const predictions = JSON.parse(readFileSync(values.predictions!, "utf8"));
  const calibration = JSON.parse(readFileSync(values.calibration!, "utf8"));
  const marks = readRecords(readFileSync(values["hand-marks"]!, "utf8"))
    .map((m) => ({ file: m.file, text: m.text, occurrence: Number(m.occurrence || 1), category: m.category as Category }));
  const report = {
    ...scoreHeldout(rows, predictions, calibration.a4),
    recall: extractorRecall(marks, readSources({ sealed: values.sealed })),
  };
  writeFileSync(values.out!, JSON.stringify(report, null, 2) + "\n");
  console.log(`beats baseline: ${report.beatsBaseline} (predictor ${report.brierPredictor}, baseline ${report.brierBaseline}, ${report.scored} scored spans)`);
  console.log(`extractor recall: ${report.recall.found} of ${report.recall.located} hand-marked spans found`);
  console.log(`wrote ${values.out}`);
}

if (import.meta.main) main();
