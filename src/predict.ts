// Source-only predictor. It must never see simplified text: no matcher, no markdown, no files.
import { extractSpans, type Category, type Span } from "./extract.ts";

export interface RateTable {
  categories: Record<Category, { rate: number | null; status: "ok" | "insufficient" }>;
  baseline: { rate: number | null };
}

export interface Prediction {
  span: Span;
  predictor: number | null;
  baseline: number | null;
  note: string;
}

export function predictSpans(source: string, table: RateTable): Prediction[] {
  return extractSpans(source).map((span) => {
    const category = table.categories[span.category];
    // #19: categories under minimum support are left out of both scores.
    if (category.status !== "ok") return { span, predictor: null, baseline: null, note: "Insufficient calibration data" };
    return { span, predictor: category.rate, baseline: table.baseline.rate, note: "" };
  });
}
