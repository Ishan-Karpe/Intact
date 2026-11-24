import assert from "node:assert/strict";
import { test } from "node:test";

import { numberRange, numberValue, parseDetail, sameMeasure } from "../src/normalize.ts";

test("number words, digits and fractions", () => {
  assert.equal(numberValue("two"), 2);
  assert.equal(numberValue("twenty-four"), 24);
  assert.equal(numberValue("1,000"), 1000);
  assert.equal(numberValue("100.4"), 100.4);
  assert.equal(numberValue("1 1/2"), 1.5);
  assert.equal(numberValue("½"), 0.5);
  assert.equal(numberValue("1½"), 1.5);
  assert.equal(numberValue("cold"), null);
});

test("ranges in any form are one range", () => {
  assert.deepEqual(numberRange("4 to 6"), [4, 6]);
  assert.deepEqual(numberRange("4-6"), [4, 6]);
  assert.deepEqual(numberRange("four–six"), [4, 6]);
  assert.deepEqual(numberRange("twenty-four"), [24, 24]);
});

test("limit, amount and time window", () => {
  const detail = parseDetail("no more than 4 tablets in 24 hours")!;
  assert.equal(detail.relation, "<=");
  assert.deepEqual(detail.amount, { low: 4, high: 4, dim: "pill" });
  assert.deepEqual(detail.per, { low: 86400, high: 86400, dim: "time" });
});

test("frequencies", () => {
  assert.deepEqual(parseDetail("twice a day"), {
    relation: null, amount: { low: 2, high: 2, dim: "times" }, times: null, per: { low: 86400, high: 86400, dim: "time" },
  });
  assert.equal(parseDetail("2 tablets twice daily")!.times, 2);
  assert.deepEqual(parseDetail("every 4 to 6 hours")!.per, { low: 14400, high: 21600, dim: "time" });
  assert.deepEqual(parseDetail("3 times a week")!.amount, { low: 3, high: 3, dim: "times" });
});

test("trailing limits and ages", () => {
  assert.equal(parseDetail("65 years and older")!.relation, ">=");
  assert.equal(parseDetail("65 years of age and older")!.amount.low, 780);
  assert.equal(parseDetail("aged 65 and older")!.amount.low, 780);
});

test("equivalent amounts compare equal", () => {
  const same = (a: string, b: string) => sameMeasure(parseDetail(a)!.amount, parseDetail(b)!.amount);
  assert.ok(same("2 hours", "120 minutes"));
  assert.ok(same("24 hours", "1 day"));
  assert.ok(same("1 year", "12 months"));
  assert.ok(same("2 tablets", "2 pills"));
  assert.ok(same("an hour", "60 minutes"));
  assert.ok(same("half an hour", "30 minutes"));
  assert.ok(!same("2 hours", "2 days"));
  assert.ok(!same("8 ounces", "8 grams"));
});
