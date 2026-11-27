import assert from "node:assert/strict";
import { test } from "node:test";

import { readability, readabilityChange, syllables } from "../src/readability.ts";

// Invented, illustrative text only. Not medical advice.
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("syllables follow the usual English heuristic", () => {
  const words: [string, number][] = [
    ["the", 1], ["eat", 1], ["hours", 1], ["health", 1], ["water", 2], ["doctor", 2], ["tablets", 2],
    ["minutes", 2], ["before", 2], ["simple", 2], ["medicine", 3], ["twenty-four", 3], ["don't", 1], ["1,000", 1],
  ];
  for (const [word, n] of words) assert.equal(syllables(word), n, word);
});

test("the grade uses Flesch-Kincaid on words, sentences and syllables", () => {
  const r = readability("The cat sat on the mat.");
  assert.deepEqual([r.words, r.sentences, r.syllables], [6, 1, 6]);
  close(r.grade, 0.39 * 6 + 11.8 - 15.59);
});

test("markdown is stripped and each bullet or table row is a sentence", () => {
  const r = readability("### **Rest**\n\n- Drink water\n- Rest for two days\n\n| Age | Amount |\n| --- | --- |\n| Adults | 1,000 mg |");
  assert.deepEqual([r.words, r.sentences, r.syllables], [12, 5, 15]);
  close(r.grade, 0.39 * (12 / 5) + 11.8 * (15 / 12) - 15.59);
});

test("the change is output minus source, and empty text has no grade", () => {
  const source = "Patients should consider hydration before strenuous exercise.";
  const output = "Drink water before you exercise.";
  close(readabilityChange(source, output), readability(output).grade! - readability(source).grade!);
  assert.ok(readabilityChange(source, output)! < 0);
  assert.equal(readability("").grade, null);
  assert.equal(readabilityChange("", output), null);
});
