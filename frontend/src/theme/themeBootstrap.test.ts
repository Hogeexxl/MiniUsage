import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
const bootstrapCases: Array<[string | null, boolean]> = [
  [null, true],
  ["dark", true],
  ["light", false],
  ["system", true],
];

function runBootstrap(stored: string | null, storageReadable = true) {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  if (stored !== null) window.localStorage.setItem("miniusage.theme", stored);
  const getItem = storageReadable
    ? null
    : vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

  expect(inlineScript).toBeTruthy();
  new Function(inlineScript ?? "")();
  getItem?.mockRestore();
  return document.documentElement.classList.contains("dark");
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("Theme first-paint bootstrap", () => {
  it.each(bootstrapCases)("maps stored theme %s to dark=%s before React", (stored, dark) => {
    expect(runBootstrap(stored, true)).toBe(dark);
  });

  it("falls back to dark when localStorage cannot be read", () => {
    expect(runBootstrap("light", false)).toBe(true);
  });

  it("executes the inline theme bootstrap before the app root and module", () => {
    const bootstrapAt = html.indexOf("window.localStorage.getItem(\"miniusage.theme\")");
    const rootAt = html.indexOf('<div id="root"></div>');
    const moduleAt = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(bootstrapAt).toBeLessThan(rootAt);
    expect(rootAt).toBeLessThan(moduleAt);
  });
});
