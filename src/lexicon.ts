// Port of intact/lexicon.py. The Python file is the frozen selection record;
// both must pass tests/lexicon_cases.json.

export const LIMIT_BEFORE = [
  "at least", "at most", "no more than", "no less than",
  "up to", "more than", "less than", "fewer than",
];
export const LIMIT_AFTER = ["or more", "or less", "or longer", "and older"];

export const TIME_UNITS: Record<string, string[]> = {
  second: ["second", "seconds", "sec", "secs"],
  minute: ["minute", "minutes", "min", "mins"],
  hour: ["hour", "hours", "hr", "hrs"],
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

export const MEASURE_UNITS: Record<string, string[]> = {
  mg: ["mg", "milligram", "milligrams"],
  mcg: ["mcg", "microgram", "micrograms"],
  g: ["g", "gram", "grams"],
  kg: ["kg", "kilogram", "kilograms"],
  mL: ["mL", "milliliter", "milliliters", "millilitre", "millilitres"],
  L: ["L", "liter", "liters", "litre", "litres"],
  oz: ["oz", "ounce", "ounces"],
  "fl oz": ["fl oz", "fluid ounce", "fluid ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  cup: ["cup", "cups"],
  tsp: ["tsp", "teaspoon", "teaspoons"],
  tbsp: ["tbsp", "tablespoon", "tablespoons"],
  "°F": ["°F", "° F", "degrees F", "degrees Fahrenheit"],
  "°C": ["°C", "° C", "degrees C", "degrees Celsius"],
  degree: ["degree", "degrees"],
  inch: ["inch", "inches"],
  foot: ["foot", "feet", "ft"],
  cm: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"],
  IU: ["IU", "international unit", "international units"],
  unit: ["unit", "units"],
  calorie: ["calorie", "calories", "kcal"],
  mmHg: ["mmHg", "mm Hg"],
  "mg/dL": ["mg/dL"],
};

export const HEALTH_COUNT_UNITS: Record<string, string[]> = Object.fromEntries(
  ["dose", "tablet", "pill", "capsule", "shot", "injection", "serving", "drink", "puff", "drop"]
    .map((name) => [name, [name, `${name}s`]]),
);

export const ONES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
export const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function forms(...tables: Record<string, string[]>[]): string[] {
  return tables.flatMap((table) => Object.values(table).flat());
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function alt(phrases: string[]): string {
  return [...new Set(phrases)]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.split(/\s+/).map(escape).join("\\s+"))
    .join("|");
}

// Python's \w is Unicode-aware; JavaScript's is not, so word characters are spelled out.
const WORD = "\\p{L}\\p{N}_";
export const END = "(?![A-Za-z])";
const DIGITS = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const FRACTION = "\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*[½¼¾⅓⅔]";
const WORDS = `(?:${TENS.join("|")})(?:-(?:${ONES.join("|")}))?|${TEENS.join("|")}|${ONES.join("|")}`;
export const SINGLE = `(?<![${WORD}/.])(?:${FRACTION}|${DIGITS}|${WORDS})(?![${WORD}/])`;
export const NUMBER = `${SINGLE}(?:\\s*(?:-|–|—|\\bto\\b)\\s*${SINGLE})?`;

export const SEP = "\\s*-?\\s*";
export const TIME_UNIT = alt(forms(TIME_UNITS));
export const QUANTITY_UNIT = alt(forms(MEASURE_UNITS, HEALTH_COUNT_UNITS));
export const ANY_UNIT = alt(forms(TIME_UNITS, MEASURE_UNITS, HEALTH_COUNT_UNITS));

export const ONCE = "(?:once|twice)\\s+(?:(?:a|per|every)\\s+(?:day|week|month|year)|daily|weekly|monthly|yearly)\\b";
export const TIMES = `${NUMBER}\\s+times?\\s+(?:a|per)\\s+(?:day|week|month|year)\\b`;
export const EVERY = `every\\s+${NUMBER}${SEP}(?:${TIME_UNIT})${END}`;
export const AMOUNT = `${NUMBER}${SEP}(?:${ANY_UNIT})${END}`;
export const AGE = "(?:\\s+(?:old|of\\s+age)\\b)?";
export const PER_DAY = "(?:\\s+(?:(?:a|per)\\s+day\\b|daily\\b))?";
export const AGED = `\\baged\\s+${NUMBER}(?:${SEP}(?:${TIME_UNIT})${END})?`;

export const BEFORE = `\\b(?:${alt(LIMIT_BEFORE)})\\s+(?:${ONCE}|${EVERY}|${TIMES}|${AMOUNT})`;
export const AFTER = `(?:${ONCE}|${EVERY}|${TIMES}|${AMOUNT}${AGE}${PER_DAY}|${AGED})\\s+(?:${alt(LIMIT_AFTER)})\\b`;

const QUALIFYING = new RegExp(`${BEFORE}|${AFTER}`, "giu");
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/giu;
const PHONE = /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}(?!\d)/gu;

// Same length as the input, so offsets still line up with the original text.
export function blankExcluded(text: string): string {
  const blank = (match: string) => " ".repeat(match.length);
  return text.replace(URL_PATTERN, blank).replace(PHONE, blank);
}

export function qualifyingPhrases(text: string): string[] {
  return [...blankExcluded(text).matchAll(QUALIFYING)].map((match) => match[0]);
}
