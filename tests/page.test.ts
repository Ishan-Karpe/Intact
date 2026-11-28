import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PAGES, brokenClaims, fillNumbers, pageNumbers } from "../audit/page.ts";
import { findSpans } from "../src/extract.ts";
import { EXAMPLE } from "../src/example.ts";
import { occurrences, readingLevel, segments, view } from "../src/view.ts";

// Invented, illustrative text only. Not medical advice.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const pageText = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");

test("each detail gets a reading, and repeats in the original point back to it", () => {
  const original = "Rest for at least 2 days. Take 1 tablet every 6 hours. Rest for at least 2 days if you can.";
  const simplified = "Take **1 tablet every 6 hours**. Rest for 2 days.";
  const v = view(original, simplified);
  assert.deepEqual(v.results.map((r) => r.span.text), ["at least 2 days", "1 tablet every 6 hours"]);
  assert.deepEqual(v.readings, ["change", "found"]);
  assert.deepEqual(v.counts, { found: 1, change: 1, unclear: 0 });
  assert.equal(v.read, "Take 1 tablet every 6 hours. Rest for 2 days.");
  assert.equal(v.original.map((s) => s.text).join(""), original);
  assert.deepEqual(v.original.filter((s) => s.reading).map((s) => [s.text, s.marks]), [["at least 2 days", [0]], ["1 tablet every 6 hours", [1]], ["at least 2 days", [0]]]);
  assert.deepEqual(v.simplified.filter((s) => s.reading).map((s) => [s.text, s.reading]), [["1 tablet every 6 hours", "found"], ["2 days", "change"]]);
});

test("an overlap shows the more serious reading, and matches stay whole", () => {
  const parts = segments("abcdef", [{ start: 0, end: 4, i: 0 }, { start: 2, end: 6, i: 1 }], ["found", "unclear"]);
  assert.deepEqual(parts.map((s) => [s.text, s.marks, s.reading]), [["ab", [0], "found"], ["cd", [0, 1], "unclear"], ["ef", [1], "unclear"]]);
  assert.deepEqual(occurrences("12 hours, 1/2 hours, 2 hours, 2 hoursly, 2 hours.", "2 hours"), [[21, 28], [41, 48]]);
  assert.deepEqual(segments("", [], []), []);
});

test("the invented example on the page shows all three readings", () => {
  const v = view(EXAMPLE.original, EXAMPLE.simplified);
  assert.deepEqual(v.counts, { found: 2, change: 2, unclear: 1 });
});

test("cards quote the negation and limit words the matcher read outside the span", () => {
  const v = view(EXAMPLE.original, EXAMPLE.simplified);
  assert.deepEqual(v.quotes.map((q) => [q.original, q.simplified]), [
    ["1 tablet every 6 hours", "1 tablet every 6 hours"],
    ["Do not take more than 4 tablets in 24 hours", "Don't take more than 4 tablets a day"],
    ["at least 2 hours", "2 hours"],
    ["below 30 °C", null],
    ["longer than 3 days", "2 hours"],
  ]);
  assert.deepEqual(v.original.filter((s) => s.reading).map((s) => s.text)[1], "Do not take more than 4 tablets in 24 hours");
  const quoted = view("Rest for 2 days or longer. Children 6 years or older.", "Rest 2 days.").quotes.map((q) => q.original);
  assert.deepEqual(quoted, ["2 days or longer", "6 years or older"]);
});

test("the context rules are exact copies of the frozen matcher's", () => {
  const rule = (file: string, name: string) => read(file).split("\n").find((line) => line.startsWith(`const ${name} =`));
  for (const name of ["NEGATED", "LEAD_BEFORE", "TRAIL_AFTER"]) assert.equal(rule("src/view.ts", name), rule("src/match.ts", name), name);
});

test("the methods page's look-alikes are missed as written and found once reordered or spaced", () => {
  for (const text of ["3 or more servings", "2 or more cups", "less than 10mg"]) assert.deepEqual(findSpans(text), [], text);
  for (const text of ["3 servings or more", "2 cups or more", "less than 10 mg"]) assert.equal(findSpans(text)[0]?.text, text);
  for (const text of ["“3 or more servings”", "“2 or more cups”", "“less than 10mg”"]) assert.ok(read("web/methods.html").includes(text), text);
});

test("the reading level shows only a whole-grade change or words", () => {
  assert.equal(readingLevel(null), "Not enough text to estimate");
  assert.equal(readingLevel(0.9), "About the same reading level");
  assert.equal(readingLevel(-1.2), "About 1 grade easier to read");
  assert.equal(readingLevel(-3.6), "About 4 grades easier to read");
  assert.equal(readingLevel(2.5), "About 3 grades harder to read");
});

test("the numbers on the pages match the committed score files, and the sentences around them still hold", () => {
  const numbers = pageNumbers(ROOT);
  assert.deepEqual(brokenClaims(numbers), []);
  for (const page of PAGES) {
    const html = read(page);
    assert.equal(fillNumbers(html, numbers), html, `${page} is out of date: run node audit/page.ts`);
  }
});

const reasons = [...read("src/match.ts").matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]).join(" ");
const texts = () => [...PAGES.map((page) => pageText(read(page))), read("src/view.ts"), read("src/page.ts"), read("src/example.ts"), reasons];

test("the pages avoid the banned words", () => {
  for (const text of texts()) assert.deepEqual(text.match(/\b(?:safe|proves?|accurate|lost)\b/gi) ?? [], []);
});

test("nothing is left to fill in on the pages", () => {
  for (const text of texts()) assert.ok(!text.includes("TODO"), "a TODO is still on a page");
});

test("the pages can't send or store anything", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    assert.doesNotMatch(html, /\b(?:src|href)="(?:https?:)?\/\//);
  }
  assert.match(read("web/index.html"), /connect-src 'none'/);
  for (const file of ["src/view.ts", "src/page.ts", "src/example.ts"]) {
    assert.doesNotMatch(read(file), /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|serviceWorker)\b/);
  }
});
