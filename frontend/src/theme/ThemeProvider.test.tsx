import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "./ThemeProvider";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./theme";

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
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeProvider", () => {
  it("defaults to dark and persists the validated theme", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent(DEFAULT_THEME);
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("restores a stored light theme and updates the root class", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("rejects unknown stored values instead of introducing a third theme state", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches through the provider API and persists the next value", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("light"));
    expect(result.current.theme).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});
