import argparse
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

# Lets `python -I audit/select_handouts.py` find the intact package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intact.lexicon import qualifying_phrases  # noqa: E402

MIN_WORDS = 150
MAX_WORDS = 250
TARGET = 20
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
LINE_BREAKS = {"p", "li", "ul", "ol", "br", "tr", "table", "div"}


@dataclass
class Topic:
    title: str
    url: str
    institute: str
    summary_html: str


@dataclass
class Candidate:
    topic: Topic
    excerpt: str | None
    excluded_by: list[str]

    @property
    def passes(self):
        return self.excerpt is not None and not self.excluded_by


class SectionParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = []
        self._lines = []
        self._line = []
        self._in_heading = False

    def handle_starttag(self, tag, attrs):
        if tag in HEADINGS:
            self._close_section()
            self._in_heading = True
        elif tag in LINE_BREAKS:
            self._close_line()
            if tag == "li":
                self._line.append("- ")
        elif tag == "td":
            self._line.append(" ")

    def handle_endtag(self, tag):
        if tag in HEADINGS:
            self._in_heading = False
        elif tag in LINE_BREAKS:
            self._close_line()

    def handle_data(self, data):
        if not self._in_heading:
            self._line.append(data)

    def close(self):
        super().close()
        self._close_section()

    def _close_line(self):
        line = " ".join("".join(self._line).split())
        if line and line != "-":
            self._lines.append(line)
        self._line = []

    def _close_section(self):
        self._close_line()
        if self._lines:
            self.sections.append("\n".join(self._lines))
        self._lines = []


def sections(html):
    parser = SectionParser()
    parser.feed(html)
    parser.close()
    return parser.sections


def word_count(text):
    return sum(1 for token in text.split() if any(ch.isalnum() for ch in token))


def first_excerpt(html):
    for section in sections(html):
        if MIN_WORDS <= word_count(section) <= MAX_WORDS and qualifying_phrases(section):
            return section
    return None


def normalize_url(url):
    parts = urlsplit(url.strip())
    return parts.netloc.lower().removeprefix("www.") + parts.path.rstrip("/").lower()


def read_exclusions(path):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return {normalize_url(line) for line in lines if line.strip() and not line.lstrip().startswith("#")}


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_topics(xml_path):
    root = ET.parse(xml_path).getroot()
    topics = []
    for node in root.iter("health-topic"):
        if node.get("language") != "English":
            continue
        summary = node.find("full-summary")
        institute = node.find("primary-institute")
        topics.append(Topic(
            title=node.get("title", ""),
            url=node.get("url", ""),
            institute=(institute.text or "").strip() if institute is not None else "",
            summary_html=(summary.text or "") if summary is not None else "",
        ))
    topics.sort(key=lambda t: (t.title.casefold(), t.url))
    seen, unique = set(), []
    for topic in topics:
        key = normalize_url(topic.url)
        if key not in seen:
            seen.add(key)
            unique.append(topic)
    return root.get("date-generated", ""), unique


def evaluate(topics, exclusions):
    return [
        Candidate(
            topic,
            first_excerpt(topic.summary_html),
            [name for name, urls in exclusions.items() if normalize_url(topic.url) in urls],
        )
        for topic in topics
    ]


def assign_splits(chosen):
    ordered = sorted(chosen, key=lambda c: c.topic.url)
    return [(i, "calibration" if i % 2 else "heldout", c) for i, c in enumerate(ordered, start=1)]


def report_counts(candidates, exclusions):
    text_pass = [c for c in candidates if c.excerpt is not None]
    print(f"English health topics: {len(candidates)}")
    print(f"With a {MIN_WORDS}-{MAX_WORDS} word section containing a qualifying phrase: {len(text_pass)}")
    for name in exclusions:
        print(f"  of those, on {name}: {sum(name in c.excluded_by for c in text_pass)}")
    passing = [i for i, c in enumerate(candidates, start=1) if c.passes]
    print(f"Pass every test: {len(passing)}")
    if len(passing) >= TARGET:
        print(f"Pass {TARGET} is topic {passing[TARGET - 1]} of {len(candidates)} in A-Z order")
    else:
        print(f"Fewer than {TARGET} pass, so the fallback list is needed")
    if not exclusions:
        print("No --exclude lists given, so these counts are an upper bound")


def select(candidates, args, generated):
    manifest_path = args.out / "handouts.json"
    if manifest_path.exists():
        print(f"{manifest_path} already exists. The selection runs once; move it aside only to redo it on purpose.")
        return 1
    passing = [(i, c) for i, c in enumerate(candidates, start=1) if c.passes]
    if len(passing) < TARGET:
        print("Not selecting: the CDC fallback list isn't built yet.")
        return 1

    pages_checked = passing[TARGET - 1][0]
    calibration_dir = args.out / "calibration"
    calibration_dir.mkdir(parents=True, exist_ok=True)
    handouts, sealed = [], []
    for position, split, c in assign_splits([c for _, c in passing[:TARGET]]):
        handouts.append({
            "position": position,
            "split": split,
            "title": c.topic.title,
            "url": c.topic.url,
            "institute": c.topic.institute,
            "words": word_count(c.excerpt),
            "excerpt_sha256": hashlib.sha256(c.excerpt.encode("utf-8")).hexdigest(),
        })
        if split == "calibration":
            slug = Path(urlsplit(c.topic.url).path).stem
            (calibration_dir / f"{position:02d}-{slug}.txt").write_text(c.excerpt + "\n", encoding="utf-8")
        else:
            sealed.append({"position": position, "url": c.topic.url, "excerpt": c.excerpt})

    sealed_path = args.out / "heldout_sealed.json"
    sealed_path.write_text(json.dumps(sealed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest = {
        "source": {"file": args.xml.name, "generated": generated, "sha256": sha256_file(args.xml)},
        "rule": {"min_words": MIN_WORDS, "max_words": MAX_WORDS, "target": TARGET},
        "pages_checked": pages_checked,
        "exclusion_lists_sha256": sorted(sha256_file(p) for p in args.exclude),
        "heldout_sealed_sha256": sha256_file(sealed_path),
        "handouts": handouts,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Pages checked: {pages_checked}")
    print(f"Calibration: {len(handouts) - len(sealed)} excerpts in {calibration_dir}")
    print(f"Held-out: {len(sealed)} excerpts sealed in {sealed_path} (sha256 {manifest['heldout_sealed_sha256']})")
    print("Do not open the sealed file until Day 4.")
    print(f"Manifest: {manifest_path}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Apply the handout selection rule to a MedlinePlus health-topics XML file.")
    parser.add_argument("command", choices=["count", "select"], help="count prints counts only; select writes the split")
    parser.add_argument("--xml", required=True, type=Path)
    parser.add_argument("--exclude", action="append", default=[], type=Path,
                        help="file of URLs to exclude, one per line (repeatable)")
    parser.add_argument("--out", type=Path, default=Path("data"))
    args = parser.parse_args(argv)
    if args.command == "select" and not args.exclude:
        parser.error("select needs the exclusion lists (--exclude)")

    generated, topics = load_topics(args.xml)
    exclusions = {path.name: read_exclusions(path) for path in args.exclude}
    candidates = evaluate(topics, exclusions)
    print(f"Source: {args.xml.name} (generated {generated}, sha256 {sha256_file(args.xml)})")
    report_counts(candidates, exclusions)
    if args.command == "select":
        return select(candidates, args, generated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
