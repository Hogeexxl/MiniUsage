import { expect, test, type Page, type Route } from "@playwright/test";

const REVISION = 100;

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", json: body });
}

function rangeFor(url: string) {
  const params = new URL(url).searchParams;
  const key = params.get("range") ?? "today";
  return { key, start_ms: 1, end_ms: 2, timezone: "Asia/Taipei" };
}

const usage = {
  input_tokens: 0,
  cached_tokens: 0,
  cache_write_tokens: 0,
  uncached_input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  other_output_tokens: 0,
  total_tokens: 0,
  cache_hit_rate: null,
  estimated_cost: 0,
  estimated_cost_status: "complete",
};

async function mockDashboard(page: Page) {
  await page.route("**/api/events*", (route) => route.abort());
  await page.route("**/api/codex/quota", (route) => json(route, { status: "unavailable" }));
  await page.route("**/api/revision*", (route) => json(route, { data_revision: REVISION, status_revision: 1 }));
  await page.route("**/api/status*", (route) => json(route, {
    data_revision: REVISION,
    status_revision: 1,
    scan_state: "idle",
    active_scan_id: null,
    last_finished_scan_id: null,
    last_finished_scan_result: null,
    followup: null,
    target_scan: null,
    last_scan_started_at_ms: null,
    last_scan_completed_at_ms: null,
    last_scan_failed_at_ms: null,
    last_scan_error_code: null,
    source_binding_status: "ready",
  }));
  await page.route("**/api/update/status*", (route) => json(route, {
    current_version: "0.2.2",
    latest_version: "0.2.2",
    update_available: false,
    release_url: null,
    last_checked_at_ms: null,
    checking: false,
  }));
  await page.route("**/api/service", (route) => json(route, { state: "running" }));
  await page.route("**/api/usage/filter-options*", (route) => json(route, { data_revision: REVISION, models: [], projects: [] }));
  await page.route("**/api/usage/summary*", (route) => json(route, {
    range: rangeFor(route.request().url()),
    data_revision: REVISION,
    usage: {
      ...usage,
      session_count: 0,
      cost_incomplete_session_count: 0,
      session_health: { total_sessions: 0, complete_sessions: 0, incomplete_sessions: 0, error_sessions: 0 },
    },
  }));
  await page.route("**/api/usage/model-distribution*", (route) => json(route, { range: rangeFor(route.request().url()), data_revision: REVISION, items: [] }));
  await page.route("**/api/usage/projects*", (route) => json(route, { range: rangeFor(route.request().url()), data_revision: REVISION, items: [] }));
  await page.route("**/api/usage/skills*", (route) => json(route, {
    range: { key: "7d", start_ms: 1, end_ms: 8, timezone: "Asia/Taipei" },
    data_revision: REVISION,
    data_status: "ready",
    days: [],
  }));
  await page.route(/\/api\/usage\/sessions\?/, (route) => json(route, {
    range: rangeFor(route.request().url()),
    data_revision: REVISION,
    total_items: 0,
    sort_index: [],
    items: [],
  }));
}

async function openPicker(page: Page) {
  const trigger = page.getByRole("tab", { name: "自定义", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "自定义日期范围" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function dayInFirstMonth(dialog: ReturnType<Page["getByRole"]>, day: number) {
  return dialog.locator(".rdp-month").first().locator("button[data-day]").filter({ hasText: new RegExp(`^${day}$`) }).first();
}

async function background(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((node) => getComputedStyle(node).backgroundColor);
}

async function settleHover(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.hover();
  await page.waitForTimeout(250);
}

test("light picker preserves hover, selected hover, and continuous range", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("miniusage.theme", "light"));
  await mockDashboard(page);
  await page.goto("/");

  let dialog = await openPicker(page);
  const nav = dialog.locator(".rdp-button_previous");
  await settleHover(page, nav);
  expect(await background(nav)).toBe("rgb(245, 245, 245)");

  const ordinary = dayInFirstMonth(dialog, 8);
  await settleHover(page, ordinary);
  expect(await background(ordinary)).toBe("rgb(245, 245, 245)");

  const start = dayInFirstMonth(dialog, 10);
  await start.click();
  await page.waitForTimeout(250);
  const selectedBeforeHover = await background(start);
  await settleHover(page, start);
  expect(await background(start)).toBe(selectedBeforeHover);

  await dayInFirstMonth(dialog, 14).click();
  await expect(dialog).toBeHidden();

  dialog = await openPicker(page);
  const middle = dayInFirstMonth(dialog, 12);
  expect(await background(middle)).toBe("rgb(245, 245, 245)");
  await settleHover(page, middle);
  expect(await background(middle)).toBe("rgb(245, 245, 245)");

  const reopenedStart = dayInFirstMonth(dialog, 10);
  const reopenedStartBg = await background(reopenedStart);
  await settleHover(page, reopenedStart);
  expect(await background(reopenedStart)).toBe(reopenedStartBg);
});

test("dark picker uses dedicated hover and range colors", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("miniusage.theme", "dark"));
  await mockDashboard(page);
  await page.goto("/");

  let dialog = await openPicker(page);
  const ordinary = dayInFirstMonth(dialog, 8);
  await settleHover(page, ordinary);
  expect(await background(ordinary)).toBe("rgb(31, 31, 31)");

  await dayInFirstMonth(dialog, 10).click();
  await dayInFirstMonth(dialog, 14).click();
  await expect(dialog).toBeHidden();

  dialog = await openPicker(page);
  const middle = dayInFirstMonth(dialog, 12);
  expect(await background(middle)).toBe("rgb(38, 38, 38)");
  await settleHover(page, middle);
  expect(await background(middle)).toBe("rgb(38, 38, 38)");
});
