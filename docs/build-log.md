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
