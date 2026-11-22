import pytest

from intact.lexicon import qualifying_phrases


@pytest.mark.parametrize("text, phrase", [
    ("Wait at least 2 hours before you eat.", "at least 2 hours"),
    ("Take no more than 4 tablets in 24 hours.", "no more than 4 tablets"),
    ("Exercise for at least 150 minutes a week.", "at least 150 minutes"),
    ("Scrub for at least twenty seconds.", "at least twenty seconds"),
    ("Rest for up to 4 to 6 hours.", "up to 4 to 6 hours"),
    ("Stretch at least 3 times a week.", "at least 3 times a week"),
    ("Get checked at least 2 times a year.", "at least 2 times a year"),
    ("Check it at least once a day.", "at least once a day"),
    ("Call if a fever lasts more than 3 days.", "more than 3 days"),
    ("Use less than ½ cup.", "less than ½ cup"),
    ("Have fewer than 2 drinks a day.", "fewer than 2 drinks"),
    ("Use at least 1,000 mg.", "at least 1,000 mg"),
    ("A temperature of 100.4°F or more is a fever.", "100.4°F or more"),
    ("Adults 65 years and older can get it.", "65 years and older"),
    ("Adults 65 years of age and older can get it.", "65 years of age and older"),
    ("People aged 65 and older can get it.", "aged 65 and older"),
    ("A nap of 20 minutes or longer helps.", "20 minutes or longer"),
    ("Have 2 servings a day or more.", "2 servings a day or more"),
])
def test_qualifying_phrases_found(text, phrase):
    assert qualifying_phrases(text) == [phrase]


@pytest.mark.parametrize("text", [
    "This is more than just a cold.",
    "More than 30 million Americans have it.",
    "At least 1 in 3 adults have it.",
    "More than 50% of people recover.",
    "Wait 2 hours before you eat.",
    "Babies younger than 6 months need care.",
    "Do not rest over 2 hours or under 1 hour.",
    "Eat at least 2 large meals.",
    "Stretch at least 2 times a decade.",
    "Read https://example.gov/wait-at-least-2-hours for more.",
])
def test_not_qualifying(text):
    assert qualifying_phrases(text) == []


def test_phone_numbers_are_not_numbers():
    assert qualifying_phrases("Call 1-800-222-1222 at least once a day.") == ["at least once a day"]
