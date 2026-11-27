# Build log

Notable moments from building Intact, with the numbers behind them.

## Nov 22, 2026: from Pyodide to TypeScript in one afternoon

**Short version.** I planned to run Intact's Python core in the browser with Pyodide, and I wrote down a rule before testing: keep Pyodide if it loads in under about 5 seconds on a laptop and runs smoothly on a phone. The laptop loaded it in 3.7 seconds. The phone stayed smooth, but it took 28 seconds before it could check anything. The rule said "smooth" when what mattered was "usable", so I switched to TypeScript that afternoon. The same similarity check now loads in 0.04 seconds on the phone and gives the same score.

### The plan

Intact compares an original health handout with an AI-simplified version. My first design kept one Python codebase for both the audit and the web page, with Python running in the browser through Pyodide (version 314.0.7) inside a Web Worker. Before building anything, I wrote down the deciding rule: Pyodide if it loads in under about 5 seconds on a laptop and is smooth on a phone, otherwise TypeScript, decided the same day and not reopened.

### What the measurements showed

| | Pyodide | TypeScript |
|---|---|---|
| Laptop (Chrome), ready to check text | 3.74 s, cold | 0.22 s |
| iPhone (Safari), ready to check text | 28.33 s, from cache | 0.04 s |
| Example score, "Wait at least 2 hours before you eat." against "Wait 2 hours before you eat." | 0.857 | 0.857 |

- The phone stayed responsive while Pyodide loaded: the longest frame gap was 62 ms, because the work ran in a background worker. By the letter of the rule, Pyodide passed.
- The 28 seconds weren't download time. The phone run came from cache, and almost all of it (28.1 s) went to starting the Python runtime.
- It wasn't one browser either. Brave and Safari on the same iPhone both took about 28 seconds, and Lockdown Mode was off.
- On the laptop, most of the 3.7 seconds also went to starting the runtime, not downloading 5.9 MB, so a slower device pays more.

### The call

Phone users are the people most likely to paste a chatbot's answer into Intact, and a half-minute wait before the page can do anything isn't usable. iPhones also pause background tabs, so I couldn't hide the wait by loading early while someone copied text from another app. I switched to TypeScript the same day, before any extractor or matcher code existed, which made the switch cheap. I recorded why I overrode the rule's literal result.

### What changed

- The extractor and matcher are written in TypeScript. Node runs the `.ts` files directly for tests and the audit, and `tsc` builds plain JavaScript for the page. There are no runtime dependencies.
- The similarity measure moved from Python's `difflib` to a word-level longest-common-subsequence ratio: 2 × shared words in order ÷ total words in both texts. It gives the same 0.857 on the example above.
- The handout-selection script that had already run stays in Python as a record. The TypeScript extractor must pass the same word-list test cases.

### Smaller lessons from the same afternoon

- In Chrome, `importScripts` couldn't load Pyodide from the CDN inside a classic worker, even though a normal fetch of the same file worked. Loading `pyodide.mjs` with `import()` in a module worker fixed it.
- My laptop had cached Pyodide from earlier tests. Loading it from a second CDN path the browser had never fetched gave a true cold measurement without clearing any browser data.
- Measure on the device people will actually use. The laptop numbers alone would have kept Pyodide.

## Nov 23, 2026: the one change Intact missed

**Short version.** I ran 10 MedlinePlus health-topic excerpts through free ChatGPT with one fixed prompt. Before hand-checking, Intact's matcher marked all 25 candidate details it tracks as preserved. The one real limit-word change in the set slipped past it: "Type 2 diabetes is above 6.5%" became "Diabetes: 6.5% or higher". Intact doesn't judge which wording is right, only whether the text changed, and this change fell outside what it tracks. So I'm reporting it as a miss rather than quietly widening the rules. With no losses to learn from, the prediction half of Intact can't be tested on this data either.

### The setup

Before collecting anything, I wrote down which details Intact tracks: limit words from a closed list (such as "at least" and "no more than"), time constraints, and quantities with units from a closed list. Percentages are not on that list. I fingerprinted those rules in `locks.txt` before the first excerpt was sent. Each excerpt went to a fresh temporary ChatGPT chat with the prompt "Rewrite this health handout in simpler words for a general reader." I kept the first response only. The free interface never showed a model name, so the run cannot confirm every reply came from the same model.

### What the matcher found

- All 25 tracked details came out preserved: 10 limit details and 15 time constraints. None of the 10 excerpts had a tracked quantity.
- These are matcher readings before hand-checking, not final labels.

### What it missed

- **A comparison word on a cutoff.** The source says "above 6.5%"; the rewrite says "6.5% or higher". Intact doesn't judge which wording is right, only that it changed, and it didn't flag this one because percentages aren't counted as quantities and "above" isn't on the closed list.
- **An added sentence.** "Your doctor may use another test to confirm the diagnosis" doesn't appear in the source. Intact checks whether source details survive; it doesn't look for new ones.
- **Softer wording.** "Checks that people with diabetes do every day" became "checks that people with diabetes may do at home".

### What it means for the prediction claim

Intact predicts which kinds of detail are likely to be lost by learning loss rates from the calibration set. With no losses there, every rate is 0%, the same as the flat baseline it is compared against, so the two make identical predictions and the comparison can't separate them. I wrote that down before hand-labeling and before the held-out run: if the predictor and the baseline agree on every held-out detail, the test is reported as not testable, and the held-out results are reported as plain counts. I didn't rescue the test with more handouts, a harsher prompt or a different chatbot, because choosing any of those after seeing the results would be tuning. The claim Intact can defend from this data is smaller: it shows what survived, and it is open about what it can't see.

### Why I didn't change the rules

The tracked details were fixed before any output existed. Adding percentages or "above" after seeing the outputs would tune Intact to this set, and the held-out run would no longer be a fair test. The page already says Intact finds candidate details only, and this example shows why that note matters.

### Smaller lessons from the same day

- Running the matcher on these outputs turned up four bugs: "Don't take more than 4" read as the opposite limit, "no longer than" wasn't a known synonym, a limit word just outside a span was ignored, and "N hours a day" was cut short. Every fix turned a false "altered" into "preserved", so the matcher's score on this set is optimistic. The held-out set, marked by hand before the matcher runs, is the fair test.
- One of those fixes was found after the outputs were seen. I recorded it with the span counts before and after (25 and 25) instead of folding it in silently.

## Nov 25, 2026: the held-out test caught the matcher, not the chatbot

**Short version.** On 10 new excerpts, ChatGPT kept all 50 details Intact tracks. Before anything ran on them, I had marked their details by hand. Intact's matcher did worse than on calibration: it misread 8 of the 50, and 6 of those were false "lost" flags. It had agreed with my calibration labels 25 of 25 times, but I fixed four matcher bugs on that same set, so I expected it to look worse on new text. This is the test built to show by how much.

### The setup

Day 3 froze the extractor, the matcher and the predictions under a git tag. Day 4 then ran in a fixed order, and each step was committed and pushed before the next could see anything new:

1. Hand-marked details, from the source text alone, under the written rules.
2. The extractor's details, the predictions and the extractor's recall, before any ChatGPT output existed.
3. The 10 outputs, from the same prompt and run rules as calibration.
4. Hand labels, checked against the matcher's reading, with every override logged with a reason.

### What the numbers show

| | Calibration | Held-out |
|---|---|---|
| Tracked details | 25 | 50 |
| Lost, by hand labels | 0 | 0 |
| Matcher readings that matched the hand labels | 25 of 25 | 42 of 50 |
| False "lost" flags (read as altered or omitted) | 0 | 6 |
| Read as uncertain, actually preserved | 0 | 2 |
| Hand-marked details the extractor found | not measured | 49 of 52 |

- Four of the eight wrong readings were limit details in one excerpt. Two of the three details the extractor missed came from the same excerpt.
- All three missed details were limit details. Intact doesn't track them, so it couldn't flag a change to any of them.
- 0 of 75 tracked details were lost, but this is a small sample. The details cluster in a few handouts: one held-out excerpt supplies 17 of the 50. It's also one chatbot, one prompt, short MedlinePlus sections and three kinds of detail.
- One person, me, marked the details and labeled the outcomes. No second annotator has checked either, so recall and labels both rest on one person's reading.
- The prediction test stayed not testable, as recorded before the run: every prediction was 0%, the same as the baseline.

### Stronger or weaker

As a tool, weaker than calibration made it look. On new text, every "lost" flag it raised was a false alarm. I still haven't seen it catch a real loss outside the unit tests, because the set had none. As evidence, stronger. The calibration score was optimistic for a known reason, and the held-out design measured the gap instead of hiding it. Every error was an over-flag, but with no real losses in the set, I can't say how often it would miss one.

### What changes

- The frozen readings stay the reported results. Any matcher fix is a new version, recorded in a dated addendum entry and shown beside the frozen results, never instead of them.
- On the page, a "lost" flag means "check this", and the page says how often flags were wrong in our test set.

### Smaller lessons from the same day

- Marking details by hand from written rules is harder than it sounds. "Over" and "a maximum of" read like limits but aren't on the list. A check against the closed lists flagged 6 of my first 63 marks before the extractor ran. After review, 11 marks moved to notes as outside the rules.
- I saved one output with the previous excerpt's text, because I hadn't refreshed the clipboard. I caught it myself. A check that matched each output to its closest source confirmed it was the only mix-up, and the save helper now refuses a clipboard that matches an output it already saved.
- The blank labeling sheet should have been committed before labeling, as on Day 3. Its matcher columns matched a fresh rebuild from committed files, so nothing in them had changed.

## Nov 26, 2026: seeding losses to see whether Intact notices

**Short version.** ChatGPT lost nothing in the held-out set, so I still didn't know whether Intact notices a real loss. I wrote down a rule before making any edit. A script then changed 17 tracked details in copies of the held-out outputs: it removed or flipped limit words, doubled numbers, swapped units and deleted details. Intact read none of the 17 as preserved. It read 8 as lost and 9 as uncertain, and it raised no false alarms on the 21 details left untouched. The split is the lesson: a changed limit word gets caught, but a changed number only makes Intact unsure.

### The setup

- I wrote the rule down first and committed its fingerprint, with the edit script, before any edit existed. I tested the script on invented text only.
- The test used the 42 held-out details that the matcher and I both read as preserved. The 8 I had overridden were left out, because a detail the matcher already misreads would be "caught" for free.
- Within each category, every other detail was edited and the rest stayed as untouched controls. That gave 21 of each. Four edits were skipped because their text wasn't unique in the output or overlapped another detail, which left 17.
- Every edit came from fixed tables, such as "at least 2 hours" becoming "2 hours". I checked each one in the diff for placement and type before the matcher ran.

### What it found

| Edit | Edited | Read as lost | Read as uncertain | Read as preserved |
|---|---|---|---|---|
| Limit word removed or flipped | 6 | 6 | 0 | 0 |
| Detail deleted | 5 | 1 | 4 | 0 |
| Number doubled | 4 | 1 | 3 | 0 |
| Unit changed | 2 | 0 | 2 | 0 |
| **All edits** | **17** | **8** | **9** | **0** |

- Before running, I wrote down what the code should do: changed limits would read as altered, and changed numbers and units as uncertain. That's what happened.
- The one deleted detail read as lost was caught for a different reason. The same number appeared elsewhere in the output with the opposite limit, so the matcher read it as a reversed limit, not a missing one.
- None of the 21 controls was flagged. They were details the matcher already read correctly, so this shows the edits didn't disturb their neighbours. It doesn't show that false alarms are rare: on the real held-out outputs, 6 of 50 flags were false alarms.

### Why "uncertain" matters

The matcher calls a mention with a different amount of the same kind "uncertain", not "altered", because it can't tell which mention the changed number belongs to. If the page flagged only details read as lost, it would have missed 9 of the 17 seeded losses, including every number and unit change. Treating uncertain as "check this" as well flags all 17. So on the page, uncertain has to mean "look at this", not "probably fine".

### What it doesn't show

- These edits are simple and mechanical, so they're easier to notice than a paraphrase that quietly drops a detail.
- 17 edits split across 8 kinds leaves 1 to 3 in most cells, so these are counts, not rates.
- It says whether Intact notices these kinds of edits. It doesn't say how often chatbots make them.

### Smaller lessons from the same day

- Alternating edits across all 42 details at once would have edited 7 of the 8 quantities and left a single control. Alternating within each category kept the controls balanced. I caught this from the committed labels before the rule was fixed.
- My first look at the diff hid half the edits. The pager cut it off, and copying a colour word-diff ran old and new words together. Plain markers (`[-old-]{+new+}`) with no pager fixed both.
