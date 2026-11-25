import assert from "node:assert/strict";
import { test } from "node:test";

import type { Category } from "../src/extract.ts";
import type { Label, LabelRow } from "../audit/rates.ts";
import { brier, extractorRecall, scoreHeldout, type SpanPrediction } from "../audit/score.ts";

let id = 0;
function row(file: string, category: Category, label: Label): LabelRow {
  return { span_id: `${file}#${++id}`, file, category, label, override: "no", reason: "", matcher_outcome: label };
}
function predict(rows: LabelRow[], rates: Partial<Record<Category, number | null>>, baseline: number) {
  const out: Record<string, SpanPrediction> = {};
  for (const r of rows) {
    const p = rates[r.category] ?? null;
    out[r.span_id] = { predictor: p, baseline: p === null ? null : baseline };
  }
  return out;
}

test("brier is the mean squared gap", () => {
  assert.equal(brier([[0.5, 1], [0.5, 0]]), 0.25);
  assert.equal(brier([]), null);
});

test("identical predictions are not testable, even with losses", () => {
  const rows = [row("01-a", "limit", "altered"), row("01-a", "limit", "preserved"), row("02-b", "time", "preserved")];
  const report = scoreHeldout(rows, predict(rows, { limit: 0, time: 0 }, 0));
  assert.equal(report.beatsBaseline, "not testable");
  assert.equal(report.categories.limit.losses, 1);
});

test("different predictions run the test", () => {
  const rows = [row("01-a", "limit", "altered"), row("01-a", "limit", "omitted"), row("02-b", "time", "preserved"), row("02-b", "time", "preserved")];
  const report = scoreHeldout(rows, predict(rows, { limit: 0.5, time: 0 }, 0.25));
  assert.equal(report.beatsBaseline, "yes");
  assert.ok(report.brierPredictor! < report.brierBaseline!);
});

test("uncertain spans and categories without a prediction stay out of both scores", () => {
  const rows = [row("01-a", "limit", "preserved"), row("01-a", "limit", "uncertain"), row("02-b", "quantity", "omitted")];
  const report = scoreHeldout(rows, predict(rows, { limit: 0.1, quantity: null }, 0.2));
  assert.equal(report.scored, 1);
  assert.equal(report.categories.quantity.losses, 1);
});

test("every labeled span needs a committed prediction", () => {
  const rows = [row("01-a", "limit", "preserved")];
  assert.throws(() => scoreHeldout(rows, {}), /no committed prediction/);
});

test("A4 on both sides", () => {
  const rows = [
    row("03-big", "time", "omitted"), row("03-big", "time", "preserved"), row("03-big", "time", "preserved"),
    row("04-small", "time", "preserved"), row("04-small", "limit", "preserved"), row("05-other", "limit", "preserved"),
  ];
  const report = scoreHeldout(rows, predict(rows, { limit: 0.2, time: 0.1 }, 0.15), [
    { handout: "17-sleep", category: "time", categoryRateWithout: 0.3, baselineWithout: 0.25 },
  ]);
  assert.deepEqual(report.a4.heldout.map((a) => [a.handout, a.category, a.share, a.lossRateWithout, a.scored]), [
    ["03-big", "time", "3 of 4", 0, 3],
  ]);
  const calibration = report.a4.calibration[0];
  assert.equal(calibration.handout, "17-sleep");
  assert.equal(calibration.scored, 6);
  assert.ok(Math.abs(calibration.brierPredictor! - 0.84 / 6) < 1e-12);
  assert.ok(Math.abs(calibration.brierBaseline! - 0.875 / 6) < 1e-12);
  assert.equal(calibration.beatsBaseline, "yes");
});

test("extractor recall counts overlaps, repeats and misses", () => {
  const sources = { "01-x": "Wait at least 2 hours. Call 1-800-222-1222. Take 5 mL. Later, wait at least 2 hours." };
  const recall = extractorRecall([
    { file: "01-x", text: "at least 2 hours", occurrence: 2, category: "limit" },
    { file: "01-x", text: "5 mL", occurrence: 1, category: "time" },
    { file: "01-x", text: "1-800-222-1222", occurrence: 1, category: "quantity" },
    { file: "01-x", text: "twice daily", occurrence: 1, category: "time" },
  ], sources);
  assert.equal(recall.marked, 4);
  assert.equal(recall.located, 3);
  assert.equal(recall.found, 2);
  assert.equal(recall.categoryAgrees, 1);
  assert.deepEqual(recall.misses.map((m) => m.text), ["1-800-222-1222"]);
  assert.deepEqual(recall.notLocated.map((m) => m.text), ["twice daily"]);
});
