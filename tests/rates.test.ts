import assert from "node:assert/strict";
import { test } from "node:test";

import type { Category } from "../src/extract.ts";
import { computeRates, validate, type Label, type LabelRow } from "../audit/rates.ts";

let id = 0;
function row(file: string, category: Category, label: Label, matcher: string = label): LabelRow {
  const override = label === matcher ? "no" : "yes";
  return { span_id: `${file}#${++id}`, file, category, label, override, reason: override === "yes" ? "checked by hand" : "", matcher_outcome: matcher };
}
const many = (n: number, file: string, category: Category, label: Label) => Array.from({ length: n }, () => row(file, category, label));

test("zero losses: rates and baseline are 0%, A6 applies, A4 flags a dominant handout", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row(`0${i}-limit`, "limit", "preserved")),
    ...many(11, "17-sleep", "time", "preserved"),
    ...many(4, "05-b", "time", "preserved"),
  ];
  const t = computeRates(rows);
  assert.equal(t.categories.limit.rate, 0);
  assert.equal(t.categories.time.rate, 0);
  assert.equal(t.categories.quantity.status, "insufficient");
  assert.equal(t.baseline.rate, 0);
  assert.equal(t.a6.applies, true);
  assert.deepEqual(t.a4.map((a) => [a.handout, a.category, a.share, a.categoryRateWithout, a.baselineWithout]), [
    ["17-sleep", "time", "11 of 15", 0, 0],
  ]);
  assert.deepEqual(t.perHandout["17-sleep"], { limit: 0, time: 11, quantity: 0 });
});

test("A4 also flags a handout that supplies every span in its category, with no figures left without it", () => {
  const t = computeRates([row("01-a", "quantity", "preserved"), ...many(3, "02-b", "time", "preserved"), row("03-c", "time", "preserved")]);
  assert.deepEqual(t.a4.map((a) => [a.handout, a.category, a.share, a.categoryRateWithout]), [
    ["02-b", "time", "3 of 4", 0],
    ["01-a", "quantity", "1 of 1", null],
  ]);
});

test("A7: uncertain spans don't count toward minimum support", () => {
  const rows = [...many(7, "01-a", "limit", "preserved"), ...many(3, "01-a", "limit", "uncertain")];
  const limit = computeRates(rows).categories.limit;
  assert.equal(limit.eligible, 7);
  assert.equal(limit.status, "insufficient");
  assert.equal(limit.rateIfUncertainLost, 0.3);
});

test("A6 is decided by the predictions: equal nonzero rates still apply, different rates don't", () => {
  const equal = computeRates([
    ...many(9, "01-a", "limit", "preserved"), row("01-a", "limit", "altered"),
    ...many(9, "02-b", "time", "preserved"), row("02-b", "time", "omitted"),
  ]);
  assert.equal(equal.categories.limit.rate, 0.1);
  assert.equal(equal.a6.applies, true);
  const different = computeRates([
    ...many(8, "01-a", "limit", "preserved"), ...many(2, "01-a", "limit", "altered"),
    ...many(10, "02-b", "time", "preserved"),
  ]);
  assert.equal(different.baseline.rate, 0.1);
  assert.equal(different.a6.applies, false);
});

test("validate catches bad labels, inconsistent overrides and missing reasons", () => {
  const rows: LabelRow[] = [
    { span_id: "x#1", file: "x", category: "limit", label: "kept" as Label, override: "no", reason: "", matcher_outcome: "preserved" },
    { span_id: "x#2", file: "x", category: "limit", label: "altered", override: "no", reason: "", matcher_outcome: "preserved" },
    { span_id: "x#3", file: "x", category: "limit", label: "altered", override: "yes", reason: "", matcher_outcome: "preserved" },
    { span_id: "x#4", file: "x", category: "limit", label: "preserved", override: "no", reason: "", matcher_outcome: "preserved" },
  ];
  const problems = validate(rows);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /x#1/);
  assert.match(problems[1], /x#2.*differs/);
  assert.match(problems[2], /x#3.*reason/);
});
