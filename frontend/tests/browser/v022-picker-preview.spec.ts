import { expect, test, type Page, type Route } from "@playwright/test";

const REVISION = 100;

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", json: body });
}

function rangeDto() {
  return { key: "today", start_ms: 1, end_ms: 2, timezone: "Asia/Taipei" };
}

function zeroUsage() {
  return {
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
}

async function mockDashboard(page: Page) {
  await page.route("**/api/events*", (route) => route.abort());
  await page.route("**/api/codex/quota", (route) => json(route, {
    status: "ready",
    account_email: "preview@example.com",
    plan_type: "prolite",
    weekly: {
      used_percent: 55,
      remaining_percent: 45,
      limit_window_seconds: 604800,
      reset_at_ms: Date.UTC(2026, 7, 30),
    },
    reset_credits_available: 2,
    fetched_at_ms: Date.UTC(2026, 7, 23),
  }));
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
  await page.route("**/api/usage/filter-options*", (route) => json(route, {
    data_revision: REVISION,
    models: [],
    projects: [],
  }));
  await page.route("**/api/usage/summary*", (route) => json(route, {
    range: rangeDto(),
    data_revision: REVISION,
    usage: {
      ...zeroUsage(),
      session_count: 0,
      cost_incomplete_session_count: 0,
      session_health: {
        total_sessions: 0,
        complete_sessions: 0,
        incomplete_sessions: 0,
        error_sessions: 0,
      },
    },
  }));
  await page.route("**/api/usage/model-distribution*", (route) => json(route, {
    range: rangeDto(), data_revision: REVISION, items: [],
  }));
  await page.route("**/api/usage/projects*", (route) => json(route, {
    range: rangeDto(), data_revision: REVISION, items: [],
  }));
  await page.route("**/api/usage/skills*", (route) => json(route, {
    range: { key: "7d", start_ms: 1, end_ms: 8, timezone: "Asia/Taipei" },
    data_revision: REVISION,
    data_status: "ready",
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(17 + index).padStart(2, "0")}`,
      start_ms: index + 1,
      end_ms: index + 2,
      total: 0,
      skills: [],
    })),
  }));
  await page.route(/\/api\/usage\/sessions\?/, (route) => json(route, {
    range: rangeDto(),
    data_revision: REVISION,
    total_items: 0,
    sort_index: [],
    items: [],
  }));
}

test("capture Base UI range picker", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("miniusage.theme", "light"));
  await mockDashboard(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MiniUsage" })).toBeVisible();

  const trigger = page.getByRole("tab", { name: "自定义", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "自定义日期范围" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);

  const triggerBox = await trigger.boundingBox();
  const dialogBox = await dialog.boundingBox();
  if (!triggerBox || !dialogBox) throw new Error("picker geometry unavailable");
  const x = Math.max(0, Math.min(triggerBox.x, dialogBox.x) - 24);
  const y = Math.max(0, Math.min(triggerBox.y, dialogBox.y) - 16);
  const right = Math.min(1512, Math.max(triggerBox.x + triggerBox.width, dialogBox.x + dialogBox.width) + 24);
  const bottom = Math.min(1000, Math.max(triggerBox.y + triggerBox.height, dialogBox.y + dialogBox.height) + 24);
  await page.screenshot({
    path: "v022-base-ui-range-picker.png",
    clip: { x, y, width: right - x, height: bottom - y },
  });
});
