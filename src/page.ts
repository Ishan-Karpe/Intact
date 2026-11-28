import { EXAMPLE } from "./example.ts";
import type { Result } from "./match.ts";
import { KIND, WORDS, view, type Reading, type Segment, type View } from "./view.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const original = $<HTMLTextAreaElement>("original");
const simplified = $<HTMLTextAreaElement>("simplified");
const results = $("results");
const panels = [$("original-read"), $("simplified-read")];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function paint(target: HTMLElement, segments: Segment[]) {
  target.replaceChildren(...segments.map((s) => {
    if (!s.reading) return document.createTextNode(s.text);
    const mark = el("mark", s.text, s.reading);
    mark.dataset.marks = s.marks.join(" ");
    mark.title = WORDS[s.reading];
    return mark;
  }));
}

// Scrolls inside each text box only, so the page itself doesn't jump.
function show(i: number) {
  for (const item of $("details").children) item.classList.toggle("active", (item as HTMLElement).dataset.i === String(i));
  for (const panel of panels) {
    let first: HTMLElement | null = null;
    for (const mark of panel.querySelectorAll<HTMLElement>("mark")) {
      const on = mark.dataset.marks!.split(" ").includes(String(i));
      mark.classList.toggle("active", on);
      if (on && !first) first = mark;
    }
    if (first) panel.scrollTop = first.offsetTop - panel.clientHeight / 3;
  }
}

function item(result: Result, reading: Reading, quote: View["quotes"][number], i: number) {
  const li = el("li", "", reading);
  li.dataset.i = String(i);
  const head = el("button", "", "head");
  head.type = "button";
  head.append(el("strong", WORDS[reading]), el("span", KIND[result.span.category], "kind"));
  head.addEventListener("click", () => show(i));
  const source = el("p");
  source.append("Original: ", el("q", quote.original));
  li.append(head, source);
  // For a different amount, the matcher points at the first one of that kind, which may belong to another detail.
  if (quote.simplified) {
    const found = el("p");
    const other = result.reason === "a different amount of the same kind appears";
    found.append(other ? "Simplified has a different amount, such as " : "Simplified: ", el("q", quote.simplified));
    li.append(found);
  }
  li.append(el("p", result.reason[0].toUpperCase() + result.reason.slice(1) + ".", "why"));
  return li;
}

function run() {
  if (!original.value.trim() || !simplified.value.trim()) {
    $("status").textContent = "Paste both texts, then press Compare.";
    results.hidden = true;
    return;
  }
  const v = view(original.value, simplified.value);
  $("status").textContent = "";
  $("stale").hidden = true;
  for (const reading of ["found", "change", "unclear"] as const) $(`count-${reading}`).textContent = String(v.counts[reading]);
  $("flag-note").hidden = v.counts.change === 0;
  $("level").textContent = v.level;
  $("shared").textContent = `${v.shared} shared wording`;
  $("none").hidden = v.results.length > 0;
  $("details").replaceChildren(...v.results.map((r, i) => item(r, v.readings[i], v.quotes[i], i)));
  paint(panels[0], v.original);
  paint(panels[1], v.simplified);
  $("simplified-note").hidden = v.read === simplified.value;
  results.hidden = false;
}

$("compare").addEventListener("click", run);
for (const box of [original, simplified]) {
  box.addEventListener("input", () => {
    if (!results.hidden) $("stale").hidden = false;
    $("example-note").hidden = true;
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) run();
  });
}

if (EXAMPLE.original && EXAMPLE.simplified) {
  const button = $("example");
  button.hidden = false;
  button.addEventListener("click", () => {
    original.value = EXAMPLE.original;
    simplified.value = EXAMPLE.simplified;
    $("example-note").hidden = false;
    run();
  });
}
