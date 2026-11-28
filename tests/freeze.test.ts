import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "data", "freeze_day3.sha256");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("the freeze manifest is the one fingerprinted in locks.txt", () => {
  const locks = readFileSync(join(ROOT, "locks.txt"), "utf8").split("\n");
  assert.ok(locks.some((line) => line.endsWith(`\t${sha256(MANIFEST)}`)));
});

// The addendum lives outside the repo and changed with A8, so only files in the repo are checked.
test("every frozen file in the repo still matches the Day 3 manifest", () => {
  const lines = readFileSync(MANIFEST, "utf8").trim().split("\n").map((line) => line.split(/\s+/));
  const inRepo = lines.filter(([, path]) => !path.startsWith("../"));
  assert.deepEqual(lines.filter(([, path]) => path.startsWith("../")).map(([, path]) => path), ["../private/lock-addendum.md"]);
  for (const [hash, path] of inRepo) assert.equal(sha256(join(ROOT, path)), hash, path);
});
