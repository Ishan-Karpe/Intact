import json
import xml.etree.ElementTree as ET

import pytest

from audit import select_handouts as sh

QUALIFYING = "Wait at least 2 hours before you eat."


def words(n, word="filler"):
    return " ".join([word] * n)


def write_xml(path, topics):
    root = ET.Element("health-topics", {"date-generated": "11/21/2026", "total": str(len(topics))})
    for title, url, language, html in topics:
        node = ET.SubElement(root, "health-topic", {"title": title, "url": url, "language": language})
        ET.SubElement(node, "full-summary").text = html
    ET.ElementTree(root).write(path, encoding="utf-8")


def test_sections_split_on_headings_without_heading_text():
    html = "<p>Intro.</p><h3>First</h3><p>Alpha.</p><ul><li>One</li><li>Two</li></ul><h3>Second</h3><p>Beta.</p>"
    assert sh.sections(html) == ["Intro.", "Alpha.\n- One\n- Two", "Beta."]


def test_word_count_ignores_bullet_marks():
    assert sh.word_count("- Take it\n- at least 2 hours") == 6


@pytest.mark.parametrize("extra, expected", [(141, False), (142, True), (242, True), (243, False)])
def test_excerpt_word_limits(extra, expected):
    html = f"<p>{QUALIFYING} {words(extra)}</p>"
    assert (sh.first_excerpt(html) is not None) == expected


def test_first_excerpt_skips_sections_that_fail():
    too_long = f"<h3>A</h3><p>{QUALIFYING} {words(300)}</p>"
    too_short = f"<h3>B</h3><p>{QUALIFYING}</p>"
    no_phrase = f"<h3>C</h3><p>{words(200)}</p>"
    first_good = f"<h3>D</h3><p>{QUALIFYING} {words(190, 'alpha')}</p>"
    second_good = f"<h3>E</h3><p>{QUALIFYING} {words(190, 'beta')}</p>"
    html = too_long + too_short + no_phrase + first_good + second_good
    assert sh.first_excerpt(html) == f"{QUALIFYING} {words(190, 'alpha')}"


def test_normalize_url():
    assert sh.normalize_url("http://www.MedlinePlus.gov/Asthma.html/") == sh.normalize_url(
        "https://medlineplus.gov/asthma.html?x=1#top"
    )


def test_split_sorts_by_url_and_alternates():
    chosen = [sh.Candidate(sh.Topic(u, u, "", ""), "x", []) for u in ("c", "a", "d", "b")]
    assert [(p, s, c.topic.url) for p, s, c in sh.assign_splits(chosen)] == [
        (1, "calibration", "a"), (2, "heldout", "b"), (3, "calibration", "c"), (4, "heldout", "d"),
    ]


def test_select_writes_calibration_and_seals_heldout(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sh, "TARGET", 2)
    xml = tmp_path / "topics.xml"
    write_xml(xml, [
        ("Alpha", "https://medlineplus.gov/alpha.html", "English", f"<p>{QUALIFYING} {words(190, 'apple')}</p>"),
        ("Alfa", "https://medlineplus.gov/spanish/alfa.html", "Spanish", f"<p>{QUALIFYING} {words(190, 'apple')}</p>"),
        ("Bravo", "https://medlineplus.gov/bravo.html", "English", f"<p>{QUALIFYING} {words(190, 'banana')}</p>"),
        ("Charlie", "https://medlineplus.gov/charlie.html", "English", f"<p>{QUALIFYING} {words(190, 'cherry')}</p>"),
        ("Delta", "https://medlineplus.gov/delta.html", "English", f"<p>{words(200)}</p>"),
    ])
    exclude = tmp_path / "exclude.txt"
    exclude.write_text("# comment\nhttps://medlineplus.gov/bravo.html\n")
    out = tmp_path / "out"
    argv = ["select", "--xml", str(xml), "--exclude", str(exclude), "--out", str(out)]

    assert sh.main(argv) == 0
    manifest = json.loads((out / "handouts.json").read_text())
    assert manifest["pages_checked"] == 3
    assert [(h["position"], h["split"], h["title"]) for h in manifest["handouts"]] == [
        (1, "calibration", "Alpha"), (2, "heldout", "Charlie"),
    ]
    assert [p.name for p in (out / "calibration").iterdir()] == ["01-alpha.txt"]
    sealed = json.loads((out / "heldout_sealed.json").read_text())
    assert "cherry" in sealed[0]["excerpt"]
    assert "cherry" not in (out / "handouts.json").read_text()
    assert "cherry" not in capsys.readouterr().out

    assert sh.main(argv) == 1


def test_select_requires_exclusion_lists(tmp_path):
    xml = tmp_path / "topics.xml"
    write_xml(xml, [])
    with pytest.raises(SystemExit):
        sh.main(["select", "--xml", str(xml)])
