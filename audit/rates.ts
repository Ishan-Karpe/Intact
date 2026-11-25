import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

import type { Category } from "../src/extract.ts";
import { readRecords } from "./csv.ts";

export const MIN_SUPPORT = 8;
export const CATEGORIES: Category[] = ["limit", "time", "quantity"];
export const LABELS = ["preserved", "omitted", "altered", "uncertain"] as const;
export type Label = (typeof LABELS)[number];

export interface LabelRow {
  span_id: string;
  file: string;
  category: Category;
  label: Label;
  override: string;
  reason: string;
  matcher_outcome: string;
}

export interface CategoryStats {
  spans: number;
  preserved: number;
  omitted: number;
  altered: number;
  uncertain: number;
  eligible: number;
  losses: number;
  rate: number | null;
  rateIfUncertainLost: number | null;
  status: "ok" | "insufficient";
}

const isLoss = (label: Label) => label === "omitted" || label === "altered";

export function stats(rows: LabelRow[]): CategoryStats {
  const count = (label: Label) => rows.filter((r) => r.label === label).length;
  const [preserved, omitted, altered, uncertain] = LABELS.map(count);
  // A7: uncertain spans are not eligible.
  const eligible = preserved + omitted + altered;
  const losses = omitted + altered;
  return {
    spans: rows.length, preserved, omitted, altered, uncertain, eligible, losses,
    rate: eligible ? losses / eligible : null,
    rateIfUncertainLost: rows.length ? (losses + uncertain) / rows.length : null,
    status: eligible >= MIN_SUPPORT ? "ok" : "insufficient",
  };
}

export function validate(rows: LabelRow[]): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    if (!LABELS.includes(r.label)) problems.push(`${r.span_id}: label "${r.label}" is not one of ${LABELS.join(", ")}`);
    if (r.override !== "yes" && r.override !== "no") problems.push(`${r.span_id}: override must be yes or no`);
    const differs = r.label !== r.matcher_outcome;
    if (LABELS.includes(r.label) && (r.override === "yes") !== differs) {
      problems.push(`${r.span_id}: override is "${r.override}" but the label ${differs ? "differs from" : "matches"} the matcher`);
    }
    if (r.override === "yes" && !r.reason.trim()) problems.push(`${r.span_id}: an override needs a reason`);
  }
  return problems;
}

export function computeRates(rows: LabelRow[]) {
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c, stats(rows.filter((r) => r.category === c))]),
  ) as Record<Category, CategoryStats>;
  // The flat baseline is the overall calibration loss rate.
  const overall = stats(rows);
  const baseline = { rate: overall.rate, eligible: overall.eligible, losses: overall.losses };

  const perHandout: Record<string, Record<Category, number>> = {};
  for (const r of rows) {
    perHandout[r.file] ??= { limit: 0, time: 0, quantity: 0 };
    perHandout[r.file][r.category]++;
  }

  // A4: a handout supplying more than half of a category's spans gets figures without it.
  const a4 = [];
  for (const c of CATEGORIES) {
    for (const [file, counts] of Object.entries(perHandout)) {
      if (categories[c].spans && counts[c] / categories[c].spans > 0.5) {
        const rest = rows.filter((r) => r.file !== file);
        const restCategory = stats(rest.filter((r) => r.category === c));
        a4.push({
          handout: file, category: c, share: `${counts[c]} of ${categories[c].spans}`,
          categoryRateWithout: restCategory.rate, categoryEligibleWithout: restCategory.eligible,
          baselineWithout: stats(rest).rate,
        });
      }
    }
  }

  // A6: decided by the predictions, not by whether there are losses.
  const passing = CATEGORIES.filter((c) => categories[c].status === "ok");
  const identical = passing.every((c) => Math.abs(categories[c].rate! - baseline.rate!) < 1e-12);
  const a6 = {
    applies: passing.length === 0 || identical,
    reason: passing.length === 0
      ? "no category meets minimum support"
      : identical
        ? "every passing category's rate equals the flat baseline, so predictor and baseline predict the same for every span"
        : "at least one passing category's rate differs from the flat baseline",
  };

  return { minSupport: MIN_SUPPORT, categories, baseline, perHandout, a4, a6 };
}

function main() {
  const labelsPath = "data/labels/calibration_labels.csv";
  const outPath = "data/predictions.json";
  const text = readFileSync(labelsPath, "utf8");
  const rows = readRecords(text) as unknown as LabelRow[];
  const problems = validate(rows);
  if (problems.length) {
    console.error(`Not writing ${outPath}. Fix these in ${labelsPath}:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  if (existsSync(outPath) && !process.argv.includes("--force")) {
    console.error(`${outPath} exists. Use --force to rewrite it before the freeze.`);
    process.exit(1);
  }
  const table = computeRates(rows);
  const labels_sha256 = createHash("sha256").update(text).digest("hex");
  writeFileSync(outPath, JSON.stringify({ labels: labelsPath, labels_sha256, ...table }, null, 2) + "\n");
  for (const c of CATEGORIES) {
    const s = table.categories[c];
    const pct = (v: number | null) => (v === null ? "n/a" : `${(100 * v).toFixed(1)}%`);
    console.log(`${c.padEnd(8)} spans ${s.spans}  P ${s.preserved} O ${s.omitted} A ${s.altered} U ${s.uncertain}  eligible ${s.eligible}  loss ${pct(s.rate)}  (uncertain as lost ${pct(s.rateIfUncertainLost)})  ${s.status === "ok" ? "" : "Insufficient calibration data"}`);
  }
  console.log(`flat baseline ${table.baseline.rate === null ? "n/a" : `${(100 * table.baseline.rate).toFixed(1)}%`} (${table.baseline.losses} of ${table.baseline.eligible})`);
  for (const a of table.a4) console.log(`A4: ${a.handout} supplies ${a.share} ${a.category} spans; ${a.category} rate without it ${a.categoryRateWithout}, baseline without it ${a.baselineWithout}`);
  console.log(`A6 ${table.a6.applies ? "applies" : "does not apply"}: ${table.a6.reason}`);
  console.log(`wrote ${outPath}`);
}

if (import.meta.main) main();
