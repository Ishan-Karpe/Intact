import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { qualifyingPhrases } from "../src/lexicon.ts";

const cases: { text: string; phrases: string[] }[] = JSON.parse(
  readFileSync(new URL("./lexicon_cases.json", import.meta.url), "utf8"),
);

for (const { text, phrases } of cases) {
  test(`qualifying phrases: ${text}`, () => {
    assert.deepEqual(qualifyingPhrases(text), phrases);
  });
}
