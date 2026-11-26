import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { toCsv } from "../audit/csv.ts";
import { SPAN_COLUMNS, checkMarks, sentenceRanges, unseal } from "../audit/heldout.ts";
import { extractorRecall } from "../audit/score.ts";

// Invented, illustrative text only. Not medical advice.
const SOURCE = "Rest for 2 hours.  Then wait at least\t2 hours before you eat.\n- Take 5 mL twice a day.";

function sheet(fill: Record<number, [text: string, category: string][]>) {
  const rows = sentenceRanges(SOURCE).flatMap((s, i) =>
    (fill[i + 1] ?? [["", ""]]).map(([text, category]) => ["01-x", String(i + 1), s.sentence, text, category, ""]));
  return toCsv([SPAN_COLUMNS, ...rows]);
}

test("sentences split on line breaks and sentence ends, with offsets back into the raw text", () => {
  const ranges = sentenceRanges(SOURCE);
  assert.deepEqual(ranges.map((r) => r.sentence), ["Rest for 2 hours.", "Then wait at least 2 hours before you eat.", "- Take 5 mL twice a day."]);
  for (const r of ranges) assert.equal(SOURCE.slice(r.start, r.end).replace(/\s+/g, " ").trim(), r.sentence);
});

test("marks get the raw source text and an occurrence the frozen scorer locates", () => {
  const { marks, problems } = checkMarks(sheet({ 2: [["at least 2 hours", "limit"], ["2 hours", "limit"]], 3: [["5 mL twice a day", "time"]] }), { "01-x": SOURCE });
  assert.deepEqual(problems, []);
  assert.deepEqual(marks.map((m) => [m.text, m.occurrence, m.category]), [
    ["at least\t2 hours", 1, "limit"],
    ["2 hours", 2, "limit"],
    ["5 mL twice a day", 1, "time"],
  ]);
  const recall = extractorRecall(marks, { "01-x": SOURCE });
  assert.equal(recall.located, 3);
  assert.equal(recall.found, 3);
});

test("blank rows are dropped, and bad rows are reported by row number without their text", () => {
  const csv = sheet({ 1: [["2 hours", "time limit"]], 2: [["", "time"], ["3 days", "time"]] });
  const { marks, problems } = checkMarks(csv, { "01-x": SOURCE });
  assert.equal(marks.length, 1);
  assert.deepEqual(problems, ["row 2: category must be limit, time or quantity", "row 3: a category but no text", "row 4: text not found in its sentence"]);
  const edited = checkMarks(csv.replace("Rest for 2 hours.", "Rest for 3 hours."), { "01-x": SOURCE });
  assert.match(edited.problems[0], /row 2: file, sentence_no and sentence don't match/);
});

test("the same text marked twice in one file gets a note", () => {
  const { notes } = checkMarks(sheet({ 1: [["2 hours", "time"]], 2: [["2 hours", "time"]] }), { "01-x": SOURCE });
  assert.match(notes[0], /rows 2, 3: the same text marked twice/);
});

test("unseal checks the fingerprint, writes each excerpt unchanged and runs only once", () => {
  const root = mkdtempSync(join(tmpdir(), "intact-unseal-"));
  const sealed = join(root, "sealed.json");
  writeFileSync(sealed, JSON.stringify([{ position: 2, url: "https://example.org/sample-topic.html", excerpt: SOURCE }]));
  const hash = createHash("sha256").update(readFileSync(sealed)).digest("hex");
  const paths = { sealed, locks: join(root, "locks.txt"), dir: join(root, "heldout"), opened: join(root, "opened.txt") };

  writeFileSync(paths.locks, `2026-11-22\theldout_sealed.json\t${"0".repeat(64)}\n`);
  assert.throws(() => unseal(paths), /does not match its fingerprint/);
  assert.equal(existsSync(paths.dir), false);

  writeFileSync(paths.locks, `2026-11-22\theldout_sealed.json\t${hash}\n`);
  assert.deepEqual(unseal(paths), { names: ["02-sample-topic"], sentences: 3 });
  assert.equal(readFileSync(join(paths.dir, "02-sample-topic.txt"), "utf8"), SOURCE);
  assert.match(readFileSync(paths.opened, "utf8"), new RegExp(`^2\\d{3}-\\d\\d-\\d\\d \\d\\d:\\d\\d \\S+\\t.*\\t${hash}\\n$`));
  assert.throws(() => unseal(paths), /runs once/);
});
