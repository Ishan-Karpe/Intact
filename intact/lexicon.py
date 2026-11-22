import re

LIMIT_BEFORE = (
    "at least", "at most", "no more than", "no less than",
    "up to", "more than", "less than", "fewer than",
)
LIMIT_AFTER = ("or more", "or less", "or longer", "and older")

TIME_UNITS = {
    "second": ("second", "seconds", "sec", "secs"),
    "minute": ("minute", "minutes", "min", "mins"),
    "hour": ("hour", "hours", "hr", "hrs"),
    "day": ("day", "days"),
    "week": ("week", "weeks"),
    "month": ("month", "months"),
    "year": ("year", "years"),
}

MEASURE_UNITS = {
    "mg": ("mg", "milligram", "milligrams"),
    "mcg": ("mcg", "microgram", "micrograms"),
    "g": ("g", "gram", "grams"),
    "kg": ("kg", "kilogram", "kilograms"),
    "mL": ("mL", "milliliter", "milliliters", "millilitre", "millilitres"),
    "L": ("L", "liter", "liters", "litre", "litres"),
    "oz": ("oz", "ounce", "ounces"),
    "fl oz": ("fl oz", "fluid ounce", "fluid ounces"),
    "lb": ("lb", "lbs", "pound", "pounds"),
    "cup": ("cup", "cups"),
    "tsp": ("tsp", "teaspoon", "teaspoons"),
    "tbsp": ("tbsp", "tablespoon", "tablespoons"),
    "°F": ("°F", "° F", "degrees F", "degrees Fahrenheit"),
    "°C": ("°C", "° C", "degrees C", "degrees Celsius"),
    "degree": ("degree", "degrees"),
    "inch": ("inch", "inches"),
    "foot": ("foot", "feet", "ft"),
    "cm": ("cm", "centimeter", "centimeters", "centimetre", "centimetres"),
    "IU": ("IU", "international unit", "international units"),
    "unit": ("unit", "units"),
    "calorie": ("calorie", "calories", "kcal"),
    "mmHg": ("mmHg", "mm Hg"),
    "mg/dL": ("mg/dL",),
}

HEALTH_COUNT_UNITS = {
    name: (name, name + "s")
    for name in ("dose", "tablet", "pill", "capsule", "shot", "injection", "serving", "drink", "puff", "drop")
}

ONES = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
TEENS = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
TENS = ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def _forms(*tables):
    return [form for table in tables for forms in table.values() for form in forms]


def _alt(phrases):
    ordered = sorted(set(phrases), key=len, reverse=True)
    return "|".join(r"\s+".join(re.escape(word) for word in phrase.split()) for phrase in ordered)


_END = r"(?![A-Za-z])"
_DIGITS = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_FRACTION = r"\d+\s+\d+/\d+|\d+/\d+|\d*[½¼¾⅓⅔]"
_WORDS = rf"(?:{'|'.join(TENS)})(?:-(?:{'|'.join(ONES)}))?|{'|'.join(TEENS)}|{'|'.join(ONES)}"
_SINGLE = rf"(?<![\w/.])(?:{_FRACTION}|{_DIGITS}|{_WORDS})(?![\w/])"
NUMBER = rf"{_SINGLE}(?:\s*(?:-|–|—|\bto\b)\s*{_SINGLE})?"

_SEP = r"\s*-?\s*"
_TIME_UNIT = _alt(_forms(TIME_UNITS))
_ANY_UNIT = _alt(_forms(TIME_UNITS, MEASURE_UNITS, HEALTH_COUNT_UNITS))

_ONCE = r"(?:once|twice)\s+(?:(?:a|per|every)\s+(?:day|week|month|year)|daily|weekly|monthly|yearly)\b"
_TIMES = rf"{NUMBER}\s+times?\s+(?:a|per)\s+(?:day|week|month|year)\b"
_EVERY = rf"every\s+{NUMBER}{_SEP}(?:{_TIME_UNIT}){_END}"
_AMOUNT = rf"{NUMBER}{_SEP}(?:{_ANY_UNIT}){_END}"
_AGE = r"(?:\s+(?:old|of\s+age)\b)?"
_PER_DAY = r"(?:\s+(?:(?:a|per)\s+day\b|daily\b))?"
_AGED = rf"\baged\s+{NUMBER}(?:{_SEP}(?:{_TIME_UNIT}){_END})?"

_BEFORE = rf"\b(?:{_alt(LIMIT_BEFORE)})\s+(?:{_ONCE}|{_EVERY}|{_TIMES}|{_AMOUNT})"
_AFTER = rf"(?:{_ONCE}|{_EVERY}|{_TIMES}|{_AMOUNT}{_AGE}{_PER_DAY}|{_AGED})\s+(?:{_alt(LIMIT_AFTER)})\b"

_QUALIFYING = re.compile(f"{_BEFORE}|{_AFTER}", re.IGNORECASE)
_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]?\d{4}(?!\d)")


def qualifying_phrases(text):
    """Closed-list limit qualifiers that form a full span (limit word, number, unit)."""
    text = _PHONE.sub(" ", _URL.sub(" ", text))
    return [m.group(0) for m in _QUALIFYING.finditer(text)]
