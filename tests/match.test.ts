import assert from "node:assert/strict";
import { test } from "node:test";

import { compare } from "../src/match.ts";

const outcome = (original: string, simplified: string) => compare(original, simplified).map((r) => r.outcome);

test("the headline example: a dropped limit word is an alteration", () => {
  assert.deepEqual(outcome("Wait at least 2 hours before you eat.", "Wait 2 hours before you eat."), ["altered"]);
});

test("equivalent wording is preserved", () => {
  const original = "Wait at least 2 hours before you eat.";
  for (const simplified of [
    "Wait at least two hours.",
    "Wait at least 120 minutes.",
    "Wait a minimum of 2 hours.",
    "Wait 2 hours or more.",
    "**Wait at least 2 hours** before eating.",
    "- Wait **at least** 2 hours.",
  ]) {
    assert.deepEqual(outcome(original, simplified), ["preserved"], simplified);
  }
});

test("synonyms, unit equivalents and time windows", () => {
  assert.deepEqual(outcome("Take no more than 4 tablets in 24 hours.", "Take a maximum of 4 pills a day."), ["preserved"]);
  assert.deepEqual(outcome("Take no more than 4 tablets in 24 hours.", "Don't take more than 4 tablets in a day."), ["preserved"]);
  assert.deepEqual(outcome("Do not take more than 4 tablets in 24 hours.", "Take no more than 4 pills a day."), ["preserved"]);
  assert.deepEqual(outcome("Do not take more than 4 tablets in 24 hours.", "Take more than 4 pills a day."), ["altered"]);
  assert.deepEqual(outcome("Take no more than 4 tablets in 24 hours.", "Take no more than 4 tablets."), ["altered"]);
  assert.deepEqual(outcome("Rest every 4 to 6 hours.", "Rest every 4-6 hours."), ["preserved"]);
  assert.deepEqual(outcome("Stretch 3 times a week.", "Stretch three times a week."), ["preserved"]);
});

test("limit words just outside a source span still count when matching", () => {
  assert.deepEqual(outcome("A short rash lasts no more than 2 to 3 weeks.", "It lasts no longer than 2 to 3 weeks."), ["preserved"]);
  assert.deepEqual(outcome("A long rash lasts longer than 2 to 3 weeks.", "It lasts longer than 2 to 3 weeks."), ["preserved"]);
  assert.deepEqual(outcome("A long rash lasts longer than 2 to 3 weeks.", "It lasts 2 to 3 weeks."), ["altered"]);
  assert.deepEqual(outcome("A rash does not last longer than 2 weeks.", "It lasts no more than 2 weeks."), ["preserved"]);
  assert.deepEqual(outcome("Toddlers need 11-14 hours a day.", "Toddlers need 11–14 hours a day."), ["preserved"]);
});

test("changed limits", () => {
  assert.deepEqual(outcome("Wait at least 2 hours.", "Wait up to 2 hours."), ["altered"]);
  assert.deepEqual(outcome("Wait at least 2 hours.", "Wait more than 2 hours."), ["uncertain"]);
});

test("missing and vague details", () => {
  assert.deepEqual(outcome("Wait at least 2 hours before you eat.", "Wait before you eat."), ["omitted"]);
  assert.deepEqual(outcome("Wait at least 2 hours before you eat.", "Wait a few hours before you eat."), ["uncertain"]);
  assert.deepEqual(outcome("Wait at least 2 hours.", "Wait at least 3 hours."), ["uncertain"]);
});

test("each source detail is judged separately", () => {
  const results = compare(
    "Wait at least 2 hours. Take 2 tablets twice a day for 10 days.",
    "Wait 2 hours. Take 2 tablets two times a day for ten days.",
  );
  assert.deepEqual(results.map((r) => [r.span.text, r.outcome]), [
    ["at least 2 hours", "altered"],
    ["2 tablets twice a day", "preserved"],
    ["10 days", "preserved"],
  ]);
});
