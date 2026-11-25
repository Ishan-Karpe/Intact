import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCsv, readRecords, toCsv } from "../audit/csv.ts";

test("values with commas, quotes, newlines and edge spaces survive a round trip", () => {
  const rows = [["a", "b"], ['say "hi", then go', "line one\nline two"], [" padded ", ""]];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("records are keyed by the header and blank lines are skipped", () => {
  assert.deepEqual(readRecords("file,label\nx#1,preserved\n\n"), [{ file: "x#1", label: "preserved" }]);
});
