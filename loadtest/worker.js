const now = () => performance.timeOrigin + performance.now();

self.onmessage = async ({ data }) => {
  const base = data.base;
  try {
    const started = now();
    const { loadPyodide } = await import(base + "pyodide.mjs");
    const scriptLoaded = now();
    const pyodide = await loadPyodide({ indexURL: base });
    const ready = now();
    const result = pyodide.runPython(`
import dataclasses, difflib, json, re
a = "Wait at least 2 hours before you eat."
b = "Wait 2 hours before you eat."
json.dumps({
    "similarity": round(difflib.SequenceMatcher(None, a.split(), b.split()).ratio(), 3),
    "spans": re.findall(r"(?:at least )?\\d+ hours", a),
})
`);
    const ran = now();
    const resources = performance.getEntriesByType("resource").map((r) => ({
      name: r.name.split("/").pop(),
      transfer: r.transferSize,
      decoded: r.decodedBodySize,
    }));
    postMessage({ started, scriptLoaded, ready, ran, result, resources });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};
