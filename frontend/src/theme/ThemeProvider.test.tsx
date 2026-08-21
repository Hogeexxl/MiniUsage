import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./ThemeProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./theme";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let fallbackStorage: Storage | undefined;

function testStorage(): Storage {
  try {
    const storage = window.localStorage;
    if (
      storage &&
      typeof storage.clear === "function" &&
      typeof storage.getItem === "function" &&
      typeof storage.key === "function" &&
      typeof storage.removeItem === "function" &&
      typeof storage.setItem === "function"
    ) {
      return storage;
    }
  } catch {
    // jsdom's default opaque origin has no localStorage implementation.
  }

  if (!fallbackStorage) {
    fallbackStorage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: fallbackStorage,
    });
  }
  return fallbackStorage;
}

function Probe() {
  const { theme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme("light")}>light</button>
      <button type="button" onClick={toggleTheme}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  testStorage().clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeProvider", () => {
  it("defaults to dark and persists the validated theme", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent(DEFAULT_THEME);
    expect(document.documentElement).toHaveClass("dark");
    expect(testStorage().getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("restores a stored light theme and updates the root class", () => {
    testStorage().setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("rejects unknown stored values instead of introducing a third theme state", () => {
    testStorage().setItem(THEME_STORAGE_KEY, "system");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(testStorage().getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("falls back to dark when storage reads are unavailable", () => {
    const getItem = vi.spyOn(testStorage(), "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    getItem.mockRestore();
  });

  it("switches through the provider API and persists the next value", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(testStorage().getItem(THEME_STORAGE_KEY)).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});
