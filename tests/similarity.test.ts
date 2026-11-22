import assert from "node:assert/strict";
import { test } from "node:test";

import { lcsLength, similarity, words } from "../src/similarity.ts";

test("words ignores case and punctuation", () => {
  assert.deepEqual(words("Wait at least 2 hours, then eat."), ["wait", "at", "least", "2", "hours", "then", "eat"]);
});

test("lcsLength counts the longest shared word sequence", () => {
  assert.equal(lcsLength(["a", "b", "c", "d"], ["b", "d", "c"]), 2);
});

test("identical texts score 1 and unrelated texts score 0", () => {
  assert.equal(similarity("Wait 2 hours.", "wait 2 hours"), 1);
  assert.equal(similarity("Wait 2 hours.", "Rest daily."), 0);
  assert.equal(similarity("", ""), 1);
});

test("a dropped limit word lowers the score", () => {
  assert.equal(similarity("Wait at least 2 hours before you eat.", "Wait 2 hours before you eat.").toFixed(3), "0.857");
});
