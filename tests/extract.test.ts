import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSpans } from "../src/extract.ts";

const spans = (text: string) => extractSpans(text).map((s) => [s.category, s.text]);

test("each category, in priority order", () => {
  assert.deepEqual(spans("Wait at least 2 hours. Take 2 tablets twice a day for 10 days. Use 5 mL."), [
    ["limit", "at least 2 hours"],
    ["time", "2 tablets twice a day"],
    ["time", "10 days"],
    ["quantity", "5 mL"],
  ]);
});

test("a limit span keeps its time window", () => {
  assert.deepEqual(spans("Take no more than 4 tablets in 24 hours."), [["limit", "no more than 4 tablets in 24 hours"]]);
  assert.deepEqual(spans("Have no more than 2 drinks a day."), [["limit", "no more than 2 drinks a day"]]);
  assert.deepEqual(spans("Exercise at least 150 minutes a week."), [["limit", "at least 150 minutes a week"]]);
  assert.deepEqual(spans("Take no more than 4 tablets in a day."), [["limit", "no more than 4 tablets in a day"]]);
  assert.deepEqual(spans("Toddlers need 11-14 hours a day."), [["time", "11-14 hours a day"]]);
});

test("ages are quantities, other durations are time", () => {
  assert.deepEqual(spans("Children 12 years old can take it."), [["quantity", "12 years old"]]);
  assert.deepEqual(spans("A 6-month-old baby."), [["quantity", "6-month-old"]]);
  assert.deepEqual(spans("People aged 65 should ask."), [["quantity", "aged 65"]]);
  assert.deepEqual(spans("Babies younger than 6 months."), [["time", "6 months"]]);
  assert.deepEqual(spans("Adults 65 years and older."), [["limit", "65 years and older"]]);
});

test("a range is one span and a repeated detail counts once", () => {
  assert.deepEqual(spans("Rest every 4 to 6 hours."), [["time", "every 4 to 6 hours"]]);
  assert.deepEqual(spans("Wait at least 2 hours. Really, wait at least two hours."), [["limit", "at least 2 hours"]]);
});

test("excluded numbers make no spans", () => {
  assert.deepEqual(spans("Call 1-800-222-1222. In 2023, step 2 helped 1 in 3 adults, or 50% of people."), []);
  assert.deepEqual(spans("See https://example.gov/wait-2-hours today."), []);
});

test("offsets point into the original text", () => {
  const text = "Call 1-800-222-1222 and wait at least 2 hours.";
  const [span] = extractSpans(text);
  assert.equal(text.slice(span.start, span.end), "at least 2 hours");
});
