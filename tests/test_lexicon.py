import json
from pathlib import Path

import pytest

from intact.lexicon import qualifying_phrases

CASES = json.loads((Path(__file__).parent / "lexicon_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["text"] for c in CASES])
def test_qualifying_phrases(case):
    assert qualifying_phrases(case["text"]) == case["phrases"]
