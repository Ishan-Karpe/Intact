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
