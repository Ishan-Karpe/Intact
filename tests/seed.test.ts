import assert from "node:assert/strict";
import { test } from "node:test";

import type { Category } from "../src/extract.ts";
import { compare } from "../src/match.ts";
import { editText, plan, scoreSeeded, seedFile, type Entry, type SheetRow } from "../audit/seed.ts";

// Invented, illustrative text only. Not medical advice.
const row = (span_id: string, category: Category, matcher_text: string, matcher_outcome = "preserved"): SheetRow => ({
  span_id, file: span_id.split("#")[0], category, label: "preserved", matcher_outcome, matcher_text,
});

test("plan alternates within each category, in file and span-number order, and rotates the edit types", () => {
  const rows = [
    row("01-a#10", "limit", "x"), row("01-a#1", "limit", "x"), row("01-a#2", "limit", "x"), row("01-a#3", "time", "x"),
    row("01-a#4", "limit", "x", "altered"), row("02-b#1", "limit", "x"), row("02-b#2", "limit", "x"),
  ];
  assert.deepEqual(plan(rows).map((p) => [p.row.span_id, p.role, p.type]), [
    ["01-a#1", "edited", 1], ["01-a#2", "control", null], ["01-a#3", "edited", 1], ["01-a#10", "edited", 2],
    ["02-b#1", "control", null], ["02-b#2", "edited", 3],
  ]);
});

test("edits come from the A8 tables, and anything they don't cover is skipped", () => {
  const cases: [Category, 1 | 2 | 3, string, string | null][] = [
    ["limit", 1, "at least 2 hours", "2 hours"],
    ["limit", 1, "65 years and older", "65 years"],
    ["limit", 2, "No more than 4 tablets in 24 hours", "At least 4 tablets in 24 hours"],
    ["limit", 2, "more than 3 days", "less than 3 days"],
    ["limit", 2, "2 hours or more", "2 hours or less"],
    ["limit", 1, "2 hours", null],
    ["time", 1, "every 4 to 6 hours", "every 8 to 12 hours"],
    ["time", 1, "twice a day", "4 times a day"],
    ["quantity", 1, "two cups", "4 cups"],
    ["time", 2, "3 times a day", "3 times a week"],
    ["time", 2, "2 hrs", "2 days"],
    ["quantity", 2, "6 months old", "6 years old"],
    ["quantity", 2, "500 mg", "500 g"],
    ["quantity", 2, "1 tablet", "1 dose"],
    ["quantity", 2, "4 servings", null],
    ["time", 3, "3 days", ""],
  ];
  for (const [category, type, text, expected] of cases) assert.equal(editText(category, type, text), expected, `${category} ${type} ${text}`);
});

test("an edit needs a unique matched text that overlaps no other span's", () => {
  const raw = "Wait **at least 2 hours** before you eat. Take 2 tablets twice a day. Rest for 3 days. Rest for 3 days again.";
  const sheet = [row("01-x#1", "limit", "at least 2 hours"), row("01-x#2", "time", "2 tablets twice a day"), row("01-x#3", "time", "3 days"), row("01-x#4", "time", "twice a day")];
  const planned = [
    { row: sheet[0], role: "edited" as const, type: 1 as const },
    { row: sheet[1], role: "control" as const, type: null },
    { row: sheet[2], role: "edited" as const, type: 3 as const },
    { row: sheet[3], role: "edited" as const, type: 1 as const },
  ];
  const { text, entries } = seedFile(raw, sheet, planned);
  assert.equal(text, "Wait **2 hours** before you eat. Take 2 tablets twice a day. Rest for 3 days. Rest for 3 days again.");
  assert.deepEqual(entries.map((e) => [e.status, e.reason]), [
    ["edited", ""], ["control", ""], ["skipped", "matched text appears 2 times"], ["skipped", "overlaps another span's matched text"],
  ]);
});

test("a deletion takes one space with it", () => {
  const sheet = [row("01-x#1", "time", "3 days")];
  assert.equal(seedFile("Rest for 3 days now.", sheet, [{ row: sheet[0], role: "edited", type: 3 }]).text, "Rest for now.");
});

test("scoring counts catches, type matches, uncertain readings and false alarms", () => {
  const entry = (span_id: string, status: string, expected = "", edit = "x"): Entry =>
    ({ span_id, file: "01-x", category: "limit", role: status === "control" ? "control" : "edited", edit, expected, status, reason: "", before: "", after: "" });
  const entries = [entry("a", "edited", "altered"), entry("b", "edited", "altered"), entry("c", "edited", "omitted"), entry("d", "control"), entry("e", "control"), entry("f", "skipped", "altered")];
  const outcomes = new Map([["a", "altered"], ["b", "uncertain"], ["c", "omitted"], ["d", "preserved"], ["e", "altered"], ["f", "preserved"]]);
  const report = scoreSeeded(entries, outcomes);
  assert.deepEqual(report.edited, { n: 3, caught: 2, uncertain: 1, flagged: 3, preserved: 0, typeMatch: 2 });
  assert.deepEqual(report.controls, { n: 2, falseAlarms: 1, uncertain: 0, preserved: 1 });
  assert.equal(report.skipped.n, 1);
});

test("on invented text the frozen matcher behaves as A8 expects: a removed limit is altered, a doubled number is uncertain", () => {
  const source = "Wait at least 2 hours before you eat. Rest for 3 days.";
  const output = "Wait at least 2 hours before eating. Then rest 3 days.";
  const sheet = [row("01-x#1", "limit", "at least 2 hours"), row("01-x#2", "time", "3 days")];
  const seeded = seedFile(output, sheet, [{ row: sheet[0], role: "edited", type: 1 }, { row: sheet[1], role: "edited", type: 1 }]).text;
  assert.equal(seeded, "Wait 2 hours before eating. Then rest 6 days.");
  assert.deepEqual(compare(source, output).map((r) => r.outcome), ["preserved", "preserved"]);
  assert.deepEqual(compare(source, seeded).map((r) => r.outcome), ["altered", "uncertain"]);
});
