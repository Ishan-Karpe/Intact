import { stripMarkdown } from "./markdown.ts";

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  grade: number | null;
}

// A common English heuristic, so every grade built on it is an estimate.
export function syllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length <= 3) return 1;
  const groups = letters.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

const isWord = (token: string) => /[\p{L}\p{N}]/u.test(token);

// Flesch-Kincaid grade after markdown is stripped; each line or bullet counts as a sentence (#17).
export function readability(text: string): Readability {
  const sentences = stripMarkdown(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.split(/\s+/).filter(isWord))
    .filter((words) => words.length);
  const words = sentences.flat();
  const count = words.reduce((n, w) => n + syllables(w), 0);
  const grade = words.length ? 0.39 * (words.length / sentences.length) + 11.8 * (count / words.length) - 15.59 : null;
  return { words: words.length, sentences: sentences.length, syllables: count, grade };
}

// Output grade minus source grade: negative means the output reads as easier.
export function readabilityChange(source: string, output: string): number | null {
  const before = readability(source).grade;
  const after = readability(output).grade;
  return before === null || after === null ? null : after - before;
}
