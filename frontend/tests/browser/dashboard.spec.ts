import fs from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

function writeBrowserControl(command: "restart" | "revision") {
  const controlFile = process.env.BROWSER_CONTROL_FILE;
  if (!controlFile) throw new Error("BROWSER_CONTROL_FILE must point to the real Axum fixture control file");
  fs.writeFileSync(controlFile, command);
}

function browserUsage(overrides: Record<string, unknown> = {}) {
  const estimatedCost = Object.prototype.hasOwnProperty.call(overrides, "estimated_cost") ? overrides.estimated_cost : 1.25;
  const estimatedCostStatus = Object.prototype.hasOwnProperty.call(overrides, "estimated_cost_status")
    ? overrides.estimated_cost_status
    : estimatedCost === null
      ? "unknown"
      : "complete";
  return {
    input_tokens: 10,
    cached_tokens: 2,
    cache_write_tokens: 1,
    uncached_input_tokens: 8,
    output_tokens: 6,
    reasoning_tokens: 3,
    other_output_tokens: 0,
    total_tokens: 16,
    cache_hit_rate: 0.2,
    estimated_cost: estimatedCost,
    estimated_cost_status: estimatedCostStatus,
    ...overrides,
  };
}

function browserSummary(range: string) {
  return {
    range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
    data_revision: 1,
    usage: { ...browserUsage(), session_count: 1 },
  };
}

function browserSession(id: string, title: string) {
  const usage = browserUsage({ estimated_cost: null });
  return {
    root_session_id: id,
    title,
    project_name: "MiniUsage",
    project_path: "/work/miniusage",
    last_activity_at_ms: Date.UTC(2026, 7, 12, 8, 0),
    models_used: ["gpt-4o"],
    subagent_count: 0,
    inclusive_usage: usage,
    self_usage: usage,
    subagent_usage: usage,
  };
}

type RealSummaryUsage = {
  input_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number | null;
  uncached_input_tokens: number | null;
  output_tokens: number;
  reasoning_tokens: number;
  other_output_tokens: number;
  total_tokens: number;
  cache_hit_rate: number | null;
  estimated_cost: number | null;
  session_count: number;
};

type RealSummaryResponse = { usage: RealSummaryUsage };

type RealProjectOption =
  | { kind: "project"; project_name: string; project_path: string }
  | { kind: "projectless" }
  | { kind: "unknown" };

type RealFilterOptionsResponse = {
  data_revision: number;
  models: string[];
  projects: RealProjectOption[];
};

type RealSessionItem = {
  root_session_id: string;
  project_path: string | null;
  [key: string]: unknown;
};

type RealSessionSnapshot = {
  data_revision: number;
  total_items: number;
  sort_index: Array<{ root_session_id: string; [key: string]: unknown }>;
  items: RealSessionItem[];
};

function browserSnapshot(range: string, sessions: ReturnType<typeof browserSession>[] = [browserSession("session-1", "First session")], dataRevision = 1_000_000) {
  return {
    range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
    data_revision: dataRevision,
    total_items: sessions.length,
    sort_index: sessions.map((session) => ({
      root_session_id: session.root_session_id,
      last_activity_at_ms: session.last_activity_at_ms,
      project_sort_key: session.project_path,
      model_sort_key: session.models_used[0] ?? null,
      total_tokens: session.inclusive_usage.total_tokens,
      combined_total_tokens: session.inclusive_usage.total_tokens,
      cache_hit_rate: session.inclusive_usage.cache_hit_rate,
    })),
    items: sessions,
  };
}

function browserDetail(range: string, rootSessionId = "session-1", dataRevision = 1_000_000) {
  const mainUsage = browserUsage({
    input_tokens: 120,
    cached_tokens: 20,
    cache_write_tokens: null,
    uncached_input_tokens: 100,
    output_tokens: 60,
    reasoning_tokens: 7,
    other_output_tokens: 53,
    total_tokens: 180,
    cache_hit_rate: 20 / 120,
    estimated_cost: null,
  });
  const secondModelUsage = browserUsage({
    input_tokens: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    uncached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    other_output_tokens: 0,
    total_tokens: 0,
    cache_hit_rate: null,
    estimated_cost: null,
  });
  const subagentUsage = browserUsage({
    input_tokens: 80,
    cached_tokens: 8,
    cache_write_tokens: 0,
    uncached_input_tokens: 72,
    output_tokens: 40,
    reasoning_tokens: 11,
    other_output_tokens: 29,
    total_tokens: 120,
    cache_hit_rate: 8 / 80,
    estimated_cost: null,
  });
  return {
    range: { key: range, start_ms: 1, end_ms: 2, timezone: "Asia/Shanghai" },
    data_revision: dataRevision,
    root_session_id: rootSessionId,
    last_activity_at_ms: Date.UTC(2026, 7, 12, 8, 0),
    main: {
      title: "First session",
      thread_id: rootSessionId,
      root_session_id: rootSessionId,
      models_used: ["gpt-5", "o4-mini"],
      model_usage: [
        { model: "gpt-5", reasoning_effort: "high", usage: mainUsage },
        { model: "o4-mini", reasoning_effort: null, usage: secondModelUsage },
      ],
      self_usage: { ...mainUsage, total_tokens: 180 },
      subagent_count: 2,
      inclusive_usage: { ...mainUsage, total_tokens: 420 },
    },
    subagents: [
      {
        thread_id: "subagent-recent-full-id",
        parent_thread_id: rootSessionId,
        root_session_id: rootSessionId,
        title: "Recent subagent",
        model: "gpt-5",
        reasoning_effort: "high",
        reasoning_effort_mixed: false,
        last_activity_at_ms: Date.UTC(2026, 7, 12, 7, 0),
        usage: subagentUsage,
      },
      {
        thread_id: "subagent-old-full-id",
        parent_thread_id: rootSessionId,
        root_session_id: rootSessionId,
        title: "Old subagent",
        model: "o4-mini",
        reasoning_effort: null,
        reasoning_effort_mixed: true,
        last_activity_at_ms: Date.UTC(2026, 7, 12, 6, 0),
        usage: { ...subagentUsage, cache_write_tokens: null },
      },
    ],
  };
}

async function realApiJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    if (!response.ok) throw new Error(`API ${requestPath} returned ${response.status}`);
    return (await response.json()) as T;
  }, path);
}

function realSummaryPath(
  range: string,
  filters: { models?: string[]; projectPaths?: string[]; projectless?: boolean; unknown?: boolean } = {},
): string {
  const params = new URLSearchParams({ range });
  for (const model of filters.models ?? []) params.append("model", model);
  for (const projectPath of filters.projectPaths ?? []) params.append("project_path", projectPath);
  if (filters.projectless) params.set("include_projectless", "1");
  if (filters.unknown) params.set("include_unknown_project", "1");
  return `/api/usage/summary?${params.toString()}`;
}

function realAccessibleRatio(value: number | null): string {
  return value === null ? "未知" : `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function realAccessibleCost(value: number | null): string {
  return value === null ? "未知" : `$${value.toFixed(2)}`;
}

async function expectRealSummaryCards(page: Page, usage: RealSummaryUsage, modelFilterActive: boolean) {
  const expected = [
    `预估费用：${realAccessibleCost(usage.estimated_cost)}`,
    `总 Token：${usage.total_tokens}`,
    `输入 Token：${usage.input_tokens}`,
    `输出 Token：${usage.output_tokens}`,
    `缓存命中率：${realAccessibleRatio(usage.cache_hit_rate)}`,
    `缓存读取 Token：${usage.cached_tokens}`,
    `推理 Token：${usage.reasoning_tokens}`,
  ];
  if (!modelFilterActive) expected.splice(4, 0, `会话数量：${usage.session_count}`);
  for (const label of expected) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  if (modelFilterActive) await expect(page.locator(".metric-label", { hasText: "会话数量" })).toHaveCount(0);
}

async function routeStableDashboardData(page: Page) {
  await page.route("**/api/usage/filter-options*", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        data_revision: 1_000_000,
        models: ["gpt-4o", "gpt-5", "claude-3"],
        projects: [
          { kind: "project", project_name: "MiniUsage", project_path: "/work/miniusage" },
          { kind: "projectless" },
          { kind: "unknown" },
        ],
      },
    });
  });
  await page.route("**/api/usage/summary*", async (route: Route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "today";
    await route.fulfill({ status: 200, contentType: "application/json", json: { ...browserSummary(range), data_revision: 1_000_000 } });
  });
  await page.route("**/api/usage/sessions*", async (route: Route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "today";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: browserSnapshot(range),
    });
  });
}

test.describe("Dashboard real browser acceptance", () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.AXUM_BASE_URL) {
      throw new Error("AXUM_BASE_URL must point to a running local Axum server; browser acceptance cannot be skipped");
    }
    const sameOrigin = new URL(process.env.FRONTEND_BASE_URL ?? "http://127.0.0.1:4173").origin;
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== sameOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      const browserWindow = window as unknown as {
        __miniStorageWrites?: number;
        __miniIndexedDbWrites?: number;
      };
      browserWindow.__miniStorageWrites = 0;
      browserWindow.__miniIndexedDbWrites = 0;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(...args: Parameters<Storage["setItem"]>) {
        browserWindow.__miniStorageWrites = (browserWindow.__miniStorageWrites ?? 0) + 1;
        throw new Error("browser storage writes are forbidden");
        return originalSetItem.apply(this, args);
      };
      try {
        const indexedDb = window.indexedDB;
        const originalOpen = indexedDb.open.bind(indexedDb);
        indexedDb.open = ((...args: Parameters<IDBFactory["open"]>) => {
          browserWindow.__miniIndexedDbWrites = (browserWindow.__miniIndexedDbWrites ?? 0) + 1;
          throw new Error("IndexedDB writes are forbidden");
          return originalOpen(...args);
        }) as IDBFactory["open"];
      } catch {
        // Browsers without a replaceable IndexedDB method still have no app writes.
      }
    });
    await page.goto("/");
  });

  test("real Vite proxy reaches loopback Axum and serves the page", async ({ page }) => {
    const apiResults = await page.evaluate(async () => {
      const health = await fetch("/api/health");
      const revision = await fetch("/api/revision");
      const summary = await fetch("/api/usage/summary?range=today");
      const refresh = await fetch("/api/refresh", { method: "POST", headers: { "X-MiniUsage-Request": "1" } });
      await refresh.json();
      return {
        health: health.status,
        revision: revision.status,
        revisionBody: await revision.json(),
        summary: summary.status,
        summaryBody: await summary.json(),
        refresh: refresh.status,
      };
    });
    expect(apiResults.health).toBe(204);
    expect(apiResults.revision).toBe(200);
    expect(apiResults.revisionBody).toEqual(expect.objectContaining({ data_revision: expect.any(Number), status_revision: expect.any(Number) }));
    expect(apiResults.summary).toBe(200);
    expect(apiResults.summaryBody.usage).toEqual(
      expect.objectContaining({
        input_tokens: expect.any(Number),
        cached_tokens: expect.any(Number),
        cache_write_tokens: expect.any(Number),
        uncached_input_tokens: expect.any(Number),
        output_tokens: expect.any(Number),
        reasoning_tokens: expect.any(Number),
        other_output_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
        session_count: expect.any(Number),
      }),
    );
    expect(apiResults.summaryBody.usage).toHaveProperty("cache_hit_rate");
    expect(apiResults.summaryBody.usage).toHaveProperty("estimated_cost");
    expect(apiResults.summaryBody.usage).not.toHaveProperty("cache_tokens");
    expect(apiResults.summaryBody.usage).not.toHaveProperty("cache_write_status");
    expect([200, 202, 409, 503]).toContain(apiResults.refresh);
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch("/api/status");
            const status = await response.json();
            return (
              (status.scan_state === "idle" || status.scan_state === "failed") &&
              status.active_scan_id === null &&
              status.followup === null
            );
          }),
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(true);
    const events = await page.evaluate(async () => {
      const controller = new AbortController();
      const response = await fetch("/api/events", { signal: controller.signal });
      const contentType = response.headers.get("content-type");
      const reader = response.body?.getReader();
      await reader?.read();
      await reader?.cancel();
      controller.abort();
      return { status: response.status, contentType };
    });
    expect(events.status).toBe(200);
    expect(events.contentType).toContain("text/event-stream");
  });

  test("T-FINAL-017 incident chain is visible through real Query API and Dashboard", async ({ page }) => {
    const incident = await page.evaluate(async () => {
      const [summaryResponse, modelsResponse, sessionsResponse, statusResponse] = await Promise.all([
        fetch("/api/usage/summary?range=year"),
        fetch("/api/usage/models?range=year"),
        fetch("/api/usage/sessions?range=year"),
        fetch("/api/status"),
      ]);
      return {
        summaryStatus: summaryResponse.status,
        summary: await summaryResponse.json(),
        modelsStatus: modelsResponse.status,
        models: await modelsResponse.json(),
        sessionsStatus: sessionsResponse.status,
        sessions: await sessionsResponse.json(),
        statusStatus: statusResponse.status,
        status: await statusResponse.json(),
      };
    });
    expect(incident.summaryStatus).toBe(200);
    expect(incident.modelsStatus).toBe(200);
    expect(incident.sessionsStatus).toBe(200);
    expect(incident.statusStatus).toBe(200);
    expect(incident.summary.usage).toEqual(
        expect.objectContaining({ total_tokens: 9, session_count: 201 }),
    );
    expect(incident.models.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "main-model", usage: expect.objectContaining({ total_tokens: 1 }) }),
        expect.objectContaining({ model: "legacy-model", usage: expect.objectContaining({ total_tokens: 1 }) }),
        expect.objectContaining({ model: "guardian-model", usage: expect.objectContaining({ total_tokens: 7 }) }),
      ]),
    );
    expect(incident.sessions.items.length).toBeLessThanOrEqual(60);
    expect(incident.sessions.total_items).toBe(201);
    expect(incident.sessions.sort_index).toHaveLength(201);
    expect(incident.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          root_session_id: "00000000-03e8-7000-8000-000000000001",
          inclusive_usage: expect.objectContaining({ total_tokens: 9 }),
        }),
      ]),
    );
    expect(incident.sessions).not.toHaveProperty("next_cursor");
    expect(incident.status).toEqual(
      expect.objectContaining({ scan_state: "idle", followup: null }),
    );

    await page.getByRole("button", { name: "今年" }).click();
    await expect(page.getByLabel("总 Token：9")).toBeVisible();
    await expect(page.getByLabel("会话数量：201")).toBeVisible();
  });

  test("T-FINAL-014 renders snapshot pagination and stale batch recovery through the real Dashboard", async ({ page }) => {
    const blockEvents = async (route: Route) => route.abort();
    await page.route("**/api/events", blockEvents);
    await page.reload();
    await page.unroute("**/api/events", blockEvents);
    await page.getByRole("button", { name: "今年" }).click();
    await expect(page.getByRole("heading", { name: "Session记录" })).toBeVisible();
    const rows = page.locator(".session-table tbody tr");
    await expect(rows).toHaveCount(15);
    await expect(page.getByText("共 201 条")).toBeVisible();
    await expect(page.getByText("当前 1 / 14 页")).toBeVisible();

    const firstSnapshot = await realApiJson<RealSessionSnapshot>(page, "/api/usage/sessions?range=year");
    expect(firstSnapshot.items.length).toBeLessThanOrEqual(60);
    expect(firstSnapshot.total_items).toBe(201);
    expect(firstSnapshot.sort_index).toHaveLength(201);
    expect(firstSnapshot).not.toHaveProperty("next_cursor");

    await page.getByRole("button", { name: "下一页" }).click();
    await expect(rows).toHaveCount(15);
    await expect(page.getByText("当前 2 / 14 页")).toBeVisible();
    const pageInput = page.getByRole("textbox", { name: "跳转页码" });
    await pageInput.fill("6");
    await pageInput.press("Enter");
    await expect(rows).toHaveCount(15);
    await expect(page.getByText("当前 6 / 14 页")).toBeVisible();

    writeBrowserControl("revision");
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch("/api/revision");
            return (await response.json()).data_revision as number;
          }),
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBeGreaterThan(firstSnapshot.data_revision);
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(async ({ revision, rootId }) => {
              const params = new URLSearchParams({ range: "year", expected_data_revision: String(revision), root_session_id: rootId });
              const response = await fetch(`/api/usage/session-rows?${params.toString()}`);
              return response.status;
            }, { revision: firstSnapshot.data_revision, rootId: firstSnapshot.sort_index[0].root_session_id });
          } catch {
            return 0;
          }
        },
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(409);
    await expect(page.locator(".session-refreshing")).toHaveCount(0);
    await expect(rows).toHaveCount(15);
    await expect(page.getByText("当前 6 / 14 页")).toBeVisible();
    writeBrowserControl("restart");
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(async () => (await fetch("/api/health")).status);
          } catch {
            return 0;
          }
        },
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(204);
    await expect(rows).toHaveCount(15);
    await expect(page.locator(".session-refreshing")).toHaveCount(0);
    await expect(page.locator(".session-table tbody tr")).toHaveCount(15);
  });

  test("T-S06-030 holds the real Session path to 200 rows under rapid interaction", async ({ page }) => {
    const blockEvents = async (route: Route) => route.abort();
    await page.route("**/api/events", blockEvents);
    await page.reload();
    await page.unroute("**/api/events", blockEvents);
    await page.getByRole("button", { name: "今年" }).click();
    const rows = page.locator(".session-table tbody tr");
    await expect(rows).toHaveCount(15);
    await expect(page.getByText("共 201 条")).toBeVisible();
    const rapidSnapshot = await realApiJson<RealSessionSnapshot>(page, "/api/usage/sessions?range=year");
    const rapidIds = rapidSnapshot.sort_index.map((entry) => entry.root_session_id);
    expect(rapidIds.length).toBeGreaterThanOrEqual(200);
    expect(new Set(rapidIds).size).toBe(rapidIds.length);
    const representativeIds = [rapidIds[30], rapidIds[90]];
    const representativeRows = await realApiJson<{ data_revision: number; items: RealSessionItem[] }>(
      page,
      `/api/usage/session-rows?range=year&expected_data_revision=${rapidSnapshot.data_revision}${representativeIds.map((id) => `&root_session_id=${encodeURIComponent(id)}`).join("")}`,
    );
    expect(representativeRows.items.map((entry) => entry.root_session_id)).toEqual(expect.arrayContaining(representativeIds));
    expect(new Set(representativeRows.items.map((entry) => entry.root_session_id)).size).toBe(representativeRows.items.length);
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(rows).toHaveCount(15);
    await expect(page.locator(".session-refreshing")).toHaveCount(0);
    await page.getByRole("button", { name: "昨天" }).click();
    await page.getByRole("button", { name: "今年" }).click();
    await expect(rows).toHaveCount(15);
    await expect(page.locator(".session-refreshing")).toHaveCount(0);
    const pageInput = page.getByRole("textbox", { name: "跳转页码" });
    let pageSevenTitles: string[] = [];
    for (const [targetPage, expectedCount] of [[3, 15], [7, 15], [14, null]] as const) {
      await pageInput.fill(String(targetPage));
      await pageInput.press("Enter");
      await expect(page.getByText(`当前 ${targetPage} / 14 页`)).toBeVisible();
      await expect(page.locator(".session-skeleton-row")).toHaveCount(0, { timeout: 15_000 });
      if (expectedCount === null) await expect.poll(() => rows.count()).toBeGreaterThan(0);
      else await expect(rows).toHaveCount(expectedCount);
      await expect(page.getByText(`当前 ${targetPage} / 14 页`)).toBeVisible();
      if (targetPage === 7) pageSevenTitles = await rows.locator("td:nth-child(2)").allTextContents();
    }
    expect(pageSevenTitles).toHaveLength(15);
    expect(new Set(pageSevenTitles).size).toBe(pageSevenTitles.length);
    await page.getByRole("button", { name: /总 Token排序/ }).click();
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    await expect(page.getByText("当前 14 / 14 页")).toBeVisible();

    await Promise.all([
      page.getByRole("button", { name: "昨天" }).click(),
      page.getByRole("button", { name: "今年" }).click(),
    ]);
    await expect(page.locator(".session-table-surface")).toBeVisible();
    const finalCount = await rows.count();
    expect(finalCount).toBeGreaterThan(0);
    expect(await page.getByRole("button", { name: "加载更多" }).count()).toBe(0);
  });

  test("checks desktop and mobile layout in a real layout engine", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await page.reload();
    const content = page.locator(".dashboard-content");
    const shell = page.locator(".dashboard-shell");
    const box = await content.boundingBox();
    const shellBox = await shell.boundingBox();
    expect(shellBox?.x).toBe(0);
    expect(box?.x).toBe(84);
    expect(box?.width).toBe(1344);
    const cards = page.locator(".metric-card");
    await expect(cards).toHaveCount(8);
    await expect
      .poll(async () => cards.evaluateAll((nodes) => nodes.map((node) => node.querySelector(".metric-label")?.textContent)))
      .toEqual([
        "预估费用",
        "总 Token",
        "输入 Token",
        "输出 Token",
        "会话数量",
        "缓存命中率",
        "缓存读取 Token",
        "推理 Token",
      ]);
    const card = await cards.first().boundingBox();
    expect(card?.x).toBe(100);
    expect(card?.width).toBe(237);
    expect(card?.height).toBe(106);
    const desktopColumns = await cards.evaluateAll((nodes) =>
      [...new Set(nodes.slice(0, 5).map((node) => Math.round(node.getBoundingClientRect().x * 100) / 100))],
    );
    expect(desktopColumns).toHaveLength(5);
    const desktopBoxes = await cards.evaluateAll((nodes) =>
      nodes.slice(0, 5).map((node) => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })),
    );
    expect(desktopBoxes[1].x - (desktopBoxes[0].x + desktopBoxes[0].width)).toBeCloseTo(31.75, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1512);

    for (const [width, columns] of [
      [1280, 4],
      [1024, 3],
      [768, 2],
      [767, 2],
      [390, 2],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect.poll(async () => page.locator(".metric-card").first().evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(0);
      await expect.poll(async () => page.locator(".metric-card").evaluateAll((nodes) =>
        new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().x))).size,
      )).toBe(columns);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);
    const mobileCards = page.locator(".metric-card");
    await expect.poll(async () => mobileCards.first().evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(0);
    await expect(mobileCards.first().locator(".metric-value")).toBeVisible();
    const mobileBox = await mobileCards.first().boundingBox();
    expect(mobileBox?.width).toBeGreaterThan(0);
    expect(mobileBox?.width).toBeLessThan(390);
    const cardStyles = await mobileCards.first().evaluate((node) => {
      const value = node.querySelector<HTMLElement>(".metric-value");
      const label = node.querySelector<HTMLElement>(".metric-label");
      return {
        cardOverflow: getComputedStyle(node).overflow,
        valueOverflow: value ? getComputedStyle(value).overflow : "",
        valueTextOverflow: value ? getComputedStyle(value).textOverflow : "",
        valueClientWidth: value?.clientWidth ?? 0,
        valueScrollWidth: value?.scrollWidth ?? 0,
        labelClientWidth: label?.clientWidth ?? 0,
        labelScrollWidth: label?.scrollWidth ?? 0,
      };
    });
    expect(cardStyles.cardOverflow).toBe("visible");
    expect(cardStyles.valueOverflow).toBe("visible");
    expect(cardStyles.valueTextOverflow).toBe("clip");
    expect(cardStyles.valueScrollWidth).toBeLessThanOrEqual(cardStyles.valueClientWidth);
    expect(cardStyles.labelScrollWidth).toBeLessThanOrEqual(cardStyles.labelClientWidth);
    await page.waitForTimeout(180);
    await expect(page.locator(".metric-card.is-updating")).toHaveCount(0);
  });

  test("T-S09-BASELINE typography uses the specified hierarchy and real JetBrains Mono weights", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await routeStableDashboardData(page);
    await page.route("**/api/status*", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          data_revision: 1_000_000,
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
        },
      });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "同步数据" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Session记录" })).toBeVisible();
    await expect(page.locator(".session-table tbody td").first()).toBeVisible();
    await expect(page.locator(".session-table tbody tr:not(.session-skeleton-row)").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".metric-card").first()).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const typography = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          color: style.color,
        };
      };
      return {
        heading: read(".dashboard-header h1"),
        sync: read(".sync-button"),
        range: read(".range-option:not(.is-selected)"),
        selectedRange: read(".range-option.is-selected"),
        metricLabel: read(".metric-label"),
      metricValue: read(".metric-value:not(.is-cost)"),
        metricCost: read(".metric-value.is-cost"),
        sessionHeading: read(".session-section-heading h2"),
        tableHeader: read(".session-table th"),
        body: read(".session-table tbody tr:not(.session-skeleton-row) td:nth-child(1)"),
        input: read(".session-table tbody tr:not(.session-skeleton-row) td:nth-child(5)"),
        cost: read(".session-table tbody tr:not(.session-skeleton-row) td:nth-child(8)"),
        synthesis: getComputedStyle(document.documentElement).fontSynthesis,
        fonts: {
          regular: document.fonts.check('400 16px "JetBrains Mono"'),
          medium: document.fonts.check('500 16px "JetBrains Mono"'),
          bold: document.fonts.check('700 16px "JetBrains Mono"'),
        },
      };
    });
    expect(typography.fonts).toEqual({ regular: true, medium: true, bold: true });
    expect(typography.synthesis).toBe("none");
    for (const section of ["heading", "sync", "range", "selectedRange", "metricLabel", "metricValue", "metricCost", "sessionHeading", "tableHeader", "body", "input", "cost"] as const) {
      expect(typography[section]?.fontFamily.startsWith('"JetBrains Mono"')).toBe(true);
    }
    expect(typography.heading).toMatchObject({ fontSize: "30px", fontWeight: "700", lineHeight: "36px", letterSpacing: "normal", color: "rgb(9, 9, 11)" });
    expect(typography.sync).toMatchObject({ fontSize: "12px", fontWeight: "500", lineHeight: "16px", color: "rgb(82, 82, 91)" });
    expect(typography.range).toMatchObject({ fontSize: "12px", fontWeight: "400", lineHeight: "16px", color: "rgb(82, 82, 91)" });
    expect(typography.selectedRange).toMatchObject({ color: "rgb(255, 255, 255)" });
    expect(typography.metricLabel).toMatchObject({ fontSize: "14px", fontWeight: "400", lineHeight: "20px", color: "rgb(82, 82, 91)" });
    expect(typography.metricValue).toMatchObject({ fontSize: "24px", fontWeight: "700", lineHeight: "32px", color: "rgb(9, 9, 11)" });
    expect(typography.metricCost).toMatchObject({ color: "rgb(52, 211, 153)" });
    expect(typography.sessionHeading).toMatchObject({ fontSize: "16px", fontWeight: "500", lineHeight: "20px", color: "rgb(82, 82, 91)" });
    expect(typography.tableHeader).toMatchObject({ fontSize: "12px", fontWeight: "500", lineHeight: "16px", letterSpacing: "0.6px", color: "rgb(82, 82, 91)" });
    expect(typography.body).toMatchObject({ fontSize: "14px", fontWeight: "400", lineHeight: "20px", color: "rgb(9, 9, 11)" });
    expect(typography.input).toMatchObject({ fontSize: "14px", fontWeight: "500", lineHeight: "20px", color: "rgb(9, 9, 11)" });
    expect(typography.cost).toMatchObject({ fontSize: "14px", fontWeight: "400", lineHeight: "20px", color: "rgb(52, 211, 153)" });
  });

  test("T-S09-001 covers the Drawer interaction, state, focus, and responsive matrix", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await routeStableDashboardData(page);
    await page.unroute("**/api/usage/sessions*");
    const session = browserSession("session-1", "First session");
    const snapshot = browserSnapshot("today", [session]);
    let detailMode: "hold" | "success" | "error" = "hold";
    let releaseDetail: (() => void) | null = null;
    await page.route("**/api/usage/sessions*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", json: snapshot });
    });
    await page.route("**/api/usage/sessions/*/detail*", async (route) => {
      if (detailMode === "hold") {
        await new Promise<void>((resolve) => { releaseDetail = resolve; });
      }
      if (detailMode === "error") {
        await route.fulfill({ status: 500, contentType: "application/json", json: { error: { code: "INTERNAL_ERROR" } } });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", json: browserDetail("today") });
    });
    await page.route("**/api/revision*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", json: { data_revision: 1_000_000, status_revision: 1 } });
    });
    await page.route("**/api/events*", async (route) => {
      await route.abort();
    });
    await page.route("**/api/status*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          data_revision: 1_000_000,
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
        },
      });
    });
    await page.reload();
    const row = page.locator(".session-table tbody tr:not(.session-skeleton-row)").first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-session-root-id", "session-1");
    const rowTreeTime = await row.locator("td").first().textContent();
    await row.click();
    const dialog = page.getByRole("dialog");
    const closeButton = dialog.getByRole("button", { name: "关闭 Session 详情" });
    await expect(dialog).toBeVisible();
    await expect(closeButton).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    const loadingTime = await dialog.locator(".session-detail-time-line time").textContent();
    expect(loadingTime).toBe(rowTreeTime);
    await expect(dialog.getByRole("status", { name: "Session 详情加载中" })).toBeVisible();
    await expect(page.locator(".dashboard-content")).toBeVisible();
    (releaseDetail as (() => void) | null)?.();
    detailMode = "success";
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    await expect(dialog.locator(".session-detail-time-line time")).toHaveText(loadingTime ?? "");
    await expect(dialog.locator(".session-detail-header")).not.toContainText("Main Session");
    await expect(dialog.locator(".session-detail-header")).not.toContainText("gpt-5");
    await expect(dialog.locator(".session-detail-id")).toHaveText("session-1");
    expect(await dialog.locator(".session-detail-summary strong").allTextContents()).toEqual(["420", "180", "240", "—"]);
    const summaryLayout = await dialog.locator(".session-detail-summary").evaluate((node) => {
      const cells = [...node.children].map((child) => child.getBoundingClientRect().width);
      const values = [...node.querySelectorAll<HTMLElement>("strong")].map((value) => getComputedStyle(value).fontSize);
      return { cells, values };
    });
    expect(summaryLayout.values).toEqual(["20px", "20px", "20px", "20px"]);
    expect(summaryLayout.cells[3]).toBeLessThan(summaryLayout.cells[0]);
    expect(summaryLayout.cells[0]).toBeCloseTo(summaryLayout.cells[1], 0);
    expect(summaryLayout.cells[1]).toBeCloseTo(summaryLayout.cells[2], 0);
    await expect(dialog.getByRole("heading", { name: "gpt-5" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "o4-mini" })).toBeVisible();
    await expect(dialog.locator(".session-detail-usage-block .session-detail-usage-item")).toHaveCount(16);
    await expect(dialog.locator('[aria-label="缓存写入：未知"]')).toHaveCount(1);
    await expect(dialog.locator('[aria-label="缓存写入：0"]')).toHaveCount(2);
    await expect(dialog.locator('[aria-label="预估费用：未知"]')).toHaveCount(3);
    const subagentToggles = dialog.getByRole("button", { name: /Subagent 详情/ });
    await expect(subagentToggles).toHaveCount(2);
    await expect(subagentToggles.nth(0)).toHaveAttribute("aria-expanded", "true");
    await expect(subagentToggles.nth(1)).toHaveAttribute("aria-expanded", "false");
    await subagentToggles.nth(1).click();
    await expect(subagentToggles.nth(0)).toHaveAttribute("aria-expanded", "true");
    await expect(subagentToggles.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.locator(".session-detail-subagent-block .session-detail-usage-item")).toHaveCount(16);
    await expect(dialog.getByText("推理 Token", { exact: true })).toHaveCount(4);
    await expect(dialog.locator('[aria-label="推理 Token：7"]')).toHaveCount(1);
    await expect(dialog.locator('[aria-label="推理 Token：0"]')).toHaveCount(1);
    await expect(dialog.locator('[aria-label="推理 Token：11"]')).toHaveCount(2);
    await expect(dialog.locator('[aria-label="缓存写入：未知"]')).toHaveCount(2);
    await expect(dialog.locator('[aria-label="预估费用：未知"]')).toHaveCount(4);
    await expect(dialog.locator(".session-detail-subagent-right-meta .session-detail-subagent-time").first()).not.toHaveText(loadingTime ?? "");

    detailMode = "hold";
    await dialog.getByRole("button", { name: "刷新当前详情" }).click();
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(dialog.locator(".session-detail-refreshing")).toBeVisible();
    (releaseDetail as (() => void) | null)?.();
    detailMode = "success";
    await expect(dialog).toHaveAttribute("aria-busy", "false");
    detailMode = "error";
    await dialog.getByRole("button", { name: "刷新当前详情" }).click();
    await expect(dialog.getByRole("alert")).toContainText("详情更新失败");
    expect(await dialog.isVisible()).toBe(true);
    detailMode = "success";
    await dialog.getByRole("button", { name: "重试" }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);

    await row.focus();
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    expect(await row.evaluate((node) => node.classList.contains("is-selected"))).toBe(true);
    const firstFocusable = dialog.getByRole("button", { name: "刷新当前详情" });
    const lastFocusable = dialog.getByRole("button", { name: /Subagent 详情/ }).last();
    await firstFocusable.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(lastFocusable).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstFocusable).toBeFocused();
    await closeButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await row.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    await row.click();
    await expect(dialog).toBeVisible();
    await page.locator(".session-detail-overlay").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();

    for (const width of [1512, 900, 640] as const) {
      await page.setViewportSize({ width, height: 900 });
      await row.click();
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.width).toBeCloseTo(width <= 640 ? width : Math.min(760, width * 0.9), 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 640) {
        const grid = dialog.locator(".session-detail-usage-grid").first();
        expect(await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(2);
        const rightMeta = dialog.locator(".session-detail-subagent-right-meta").first();
        const metaLayout = await rightMeta.evaluate((node) => {
          const style = getComputedStyle(node);
          const model = node.querySelector<HTMLElement>(".session-detail-subagent-model");
          const modelStyle = model ? getComputedStyle(model) : null;
          const header = node.closest<HTMLElement>(".session-detail-subagent-header");
          const metaBox = node.getBoundingClientRect();
          const headerBox = header?.getBoundingClientRect();
          return {
            flexDirection: style.flexDirection,
            flexWrap: header ? getComputedStyle(header).flexWrap : "",
            whiteSpace: modelStyle?.whiteSpace ?? "",
            overflowWrap: modelStyle?.overflowWrap ?? "",
            metaWithinHeader: Boolean(headerBox && metaBox.left >= headerBox.left && metaBox.right <= headerBox.right),
          };
        });
        expect(metaLayout).toMatchObject({ flexDirection: "column", flexWrap: "wrap", whiteSpace: "normal", overflowWrap: "anywhere", metaWithinHeader: true });
      }
      await dialog.getByRole("button", { name: "关闭 Session 详情" }).click();
      await expect(dialog).toHaveCount(0);
    }
  });

  test("T-S09-002 keeps model and project filters in one flow with immediate multi-select interaction", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    const summaryRequests: string[] = [];
    await routeStableDashboardData(page);
    await page.unroute("**/api/usage/summary*");
    await page.route("**/api/usage/summary*", async (route: Route) => {
      summaryRequests.push(route.request().url());
      const range = new URL(route.request().url()).searchParams.get("range") ?? "today";
      await route.fulfill({ status: 200, contentType: "application/json", json: browserSummary(range) });
    });
    await page.reload();

    await expect(page.locator(".filter-selector")).toHaveCount(2);
    await expect(page.locator(".filter-selector")).toContainText(["模型", "项目"]);
    const controlsStyle = await page.locator(".dashboard-controls-row").evaluate((node) => {
      const style = getComputedStyle(node);
      return { display: style.display, flexWrap: style.flexWrap, gap: style.gap };
    });
    expect(controlsStyle).toEqual({ display: "flex", flexWrap: "wrap", gap: "8px" });

    const modelTrigger = page.getByRole("button", { name: /模型筛选/ });
    expect(await modelTrigger.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        height: style.height,
        padding: style.padding,
        gap: style.gap,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
      };
    })).toEqual({
      height: "28px",
      padding: "6px 12px",
      gap: "6px",
      borderRadius: "9999px",
      fontSize: "12px",
      fontWeight: "400",
      lineHeight: "16px",
      color: "rgb(82, 82, 91)",
      backgroundColor: "rgb(226, 227, 231)",
    });
    expect(await modelTrigger.locator(".filter-trigger-icon").evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.width, height: style.height };
    })).toEqual({ width: "12px", height: "12px" });
    expect(await modelTrigger.locator(".filter-trigger-chevron").evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.width, height: style.height };
    })).toEqual({ width: "10px", height: "10px" });
    await modelTrigger.click();
    const modelPanel = page.locator("#models-filter-options");
    await expect(modelPanel).toBeVisible();
    const popoverGeometry = await modelPanel.evaluate((node) => {
      const style = getComputedStyle(node);
      const parent = node.parentElement;
      const topGap = parent ? node.getBoundingClientRect().top - parent.getBoundingClientRect().bottom : -1;
      return {
        topGap,
        minWidth: style.minWidth,
        maxHeight: style.maxHeight,
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        borderTopColor: style.borderTopColor,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(popoverGeometry.topGap).toBeCloseTo(6, 1);
    expect(popoverGeometry).toMatchObject({
      minWidth: "192px",
      maxHeight: "288px",
      borderRadius: "8px",
      borderTopWidth: "1px",
      borderTopColor: "rgb(228, 228, 231)",
      backgroundColor: "rgb(255, 255, 255)",
    });
    await expect(page.getByRole("checkbox", { name: "gpt-4o" })).toBeVisible();
    expect(await page.locator(".filter-option-child").first().evaluate((node) => {
      const style = getComputedStyle(node);
      return { height: style.height, padding: style.padding, paddingLeft: style.paddingLeft, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
    })).toEqual({ height: "32px", padding: "8px 12px 8px 28px", paddingLeft: "28px", fontSize: "12px", fontWeight: "400", lineHeight: "16px" });
    expect(await page.getByRole("checkbox", { name: "gpt-4o" }).evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.width, height: style.height };
    })).toEqual({ width: "14px", height: "14px" });
    await expect(page.getByRole("button", { name: "GPT" })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "GPT" }).click();
    await expect(page.locator(".filter-option-child")).toHaveCount(0);
    await page.getByRole("button", { name: "GPT" }).click();
    await expect(page.locator(".filter-option-child")).toHaveCount(2);
    await page.getByRole("checkbox", { name: "gpt-4o" }).check();
    await expect(page.getByRole("checkbox", { name: "GPT", exact: true })).toHaveAttribute("aria-checked", "mixed");
    await page.getByRole("checkbox", { name: "gpt-5" }).check();
    await expect(page.getByRole("checkbox", { name: "GPT", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(modelPanel).toBeVisible();
    await page.getByRole("checkbox", { name: "GPT", exact: true }).uncheck();
    await expect(page.getByRole("checkbox", { name: "gpt-4o" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "claude-3" }).check();
    await expect(page.getByRole("button", { name: /模型筛选，已选1项/ })).toBeVisible();
    const activeTrigger = page.getByRole("button", { name: /模型筛选，已选1项/ });
    await expect(activeTrigger).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(activeTrigger).toHaveCSS("background-color", "rgb(24, 24, 27)");
    const activeTriggerStyle = await activeTrigger.evaluate((node) => {
      const style = getComputedStyle(node);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, className: node.className, disabled: (node as HTMLButtonElement).disabled, matchesDisabled: node.matches(":disabled") };
    });
    expect(activeTriggerStyle).toMatchObject({ fontSize: "12px", fontWeight: "400", lineHeight: "16px", disabled: false, matchesDisabled: false });

    const projectTrigger = page.getByRole("button", { name: /项目筛选/ });
    await projectTrigger.click();
    const projectPanel = page.locator("#projects-filter-options");
    await expect(projectPanel).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "MiniUsage" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "无项目会话" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "未识别项目" })).toBeVisible();
    await expect(page.locator(".filter-option-text", { hasText: "MiniUsage" })).toHaveAttribute("title", "/work/miniusage");
    await page.getByRole("checkbox", { name: "MiniUsage" }).check();
    await page.getByRole("checkbox", { name: "未识别项目" }).check();
    await expect(page.getByRole("button", { name: /项目筛选，已选2项/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();

    await page.mouse.click(1200, 700);
    await expect(projectPanel).toHaveCount(0);
    await projectTrigger.click();
    await expect(projectPanel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(projectPanel).toHaveCount(0);

    await page.getByRole("button", { name: /模型筛选/ }).click();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.getByRole("button", { name: /模型筛选，全部/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /项目筛选，全部/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "清除筛选" })).toHaveCount(0);
    expect(summaryRequests.some((requestUrl) => new URL(requestUrl).searchParams.getAll("model").includes("claude-3"))).toBe(true);
    expect(summaryRequests.some((requestUrl) => new URL(requestUrl).searchParams.get("include_unknown_project") === "1")).toBe(true);
  });

  test("T-S07-001 renders eight Session columns, sort directions, and snapshot requests", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await page.route("**/api/usage/filter-options*", async (route: Route) => {
      await route.fulfill({ status: 200, contentType: "application/json", json: { data_revision: 1, models: [], projects: [] } });
    });
    await page.route("**/api/usage/summary*", async (route: Route) => {
      const range = new URL(route.request().url()).searchParams.get("range") ?? "today";
      await route.fulfill({ status: 200, contentType: "application/json", json: browserSummary(range) });
    });
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/usage/sessions")) sessionRequests.push(request.url());
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Session记录" })).toBeVisible();
    await expect(page.locator(".session-table thead th")).toHaveCount(8);
    await expect(page.locator(".session-table thead button")).toHaveCount(6);
    await page.getByRole("button", { name: "今年" }).click();
    await expect(page.locator(".session-table tbody tr")).toHaveCount(15);
    await expect(page.locator(".session-table tbody")).not.toContainText("当前时间范围暂无 Session 记录");
    await expect(page.getByRole("button", { name: "加载更多" })).toHaveCount(0);
    await expect(page.getByLabel("每页")).toHaveCount(0);
    for (const requestUrl of sessionRequests) {
      const keys = [...new URL(requestUrl).searchParams.keys()];
      expect(keys.every((key) => key === "range" || key === "seed_sort_by" || key === "seed_sort_order")).toBe(true);
      expect(requestUrl).not.toContain("cursor=");
      expect(requestUrl).not.toContain("limit=");
      expect(requestUrl).not.toContain("model=");
      expect(requestUrl).not.toContain("project_path=");
    }
    const cacheHeader = page.getByRole("columnheader").filter({ hasText: "缓存命中率" });
    await page.getByRole("button", { name: /缓存命中率排序/ }).click();
    await expect(cacheHeader).toContainText(/缓存命中率 [↑↓]/);
    const firstCacheDirection = await cacheHeader.textContent();
    await page.getByRole("button", { name: /缓存命中率排序/ }).click();
    await expect(cacheHeader).toContainText(/缓存命中率 [↑↓]/);
    await expect(cacheHeader).not.toHaveText(firstCacheDirection ?? "");
  });

  test("T-S10-001 closes the real Axum filter/KPI matrix with canonical Session scopes", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    const filterOptionRequests: string[] = [];
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/api/usage/filter-options")) filterOptionRequests.push(request.url());
      if (url.pathname.endsWith("/api/usage/sessions")) sessionRequests.push(request.url());
    });
    const options = await realApiJson<RealFilterOptionsResponse>(page, "/api/usage/filter-options");
    filterOptionRequests.length = 0;
    await page.reload();
    await expect(page.getByRole("button", { name: /模型筛选，全部/ })).toBeVisible();
    await expect.poll(() => filterOptionRequests.length).toBe(1);
    expect(options.models).toEqual(expect.arrayContaining(["main-model", "guardian-model", "extra-model"]));
    const ordinaryProject = options.projects.find(
      (project): project is Extract<RealProjectOption, { kind: "project" }> =>
        project.kind === "project" && project.project_path === "/work/main",
    );
    if (!ordinaryProject) throw new Error("real filter-options did not expose /work/main");
    expect(ordinaryProject).toEqual({ kind: "project", project_name: "main", project_path: "/work/main" });
    expect(options.projects).toEqual(expect.arrayContaining([{ kind: "projectless" }, { kind: "unknown" }]));
    expect(options.projects.filter((project) => project.kind !== "project").every((project) => !("project_path" in project))).toBe(true);

    const summaryFor = (range: string, filters: Parameters<typeof realSummaryPath>[1] = {}) =>
      realApiJson<RealSummaryResponse>(page, realSummaryPath(range, filters));
    const sessionPath = (range: string, filters: Parameters<typeof realSummaryPath>[1] = {}) => {
      const params = new URLSearchParams({ range });
      for (const model of filters.models ?? []) params.append("model", model);
      for (const projectPath of filters.projectPaths ?? []) params.append("project_path", projectPath);
      if (filters.projectless) params.set("include_projectless", "1");
      if (filters.unknown) params.set("include_unknown_project", "1");
      return `/api/usage/sessions?${params.toString()}`;
    };
    const sessionsFor = (range: string, filters: Parameters<typeof realSummaryPath>[1] = {}) => realApiJson<RealSessionSnapshot>(page, sessionPath(range, filters));
    const sessionRows = page.locator(".session-table tbody tr");

    await page.getByRole("button", { name: "今年" }).click();
    const yearSummary = await summaryFor("year");
    await expectRealSummaryCards(page, yearSummary.usage, false);
    await expect(sessionRows).toHaveCount(15);
    const yearFirst = await sessionsFor("year");
    expect(yearFirst.items.length).toBeLessThanOrEqual(60);
    expect(yearFirst.total_items).toBe(201);
    expect(yearFirst.sort_index).toHaveLength(201);
    expect(yearFirst).not.toHaveProperty("next_cursor");
    const projectlessRows = await realApiJson<{ data_revision: number; items: RealSessionItem[] }>(page, `/api/usage/session-rows?range=year&root_session_id=${encodeURIComponent("00000000-03e8-7000-8000-000000000064")}&expected_data_revision=${yearFirst.data_revision}`);
    expect(projectlessRows.items[0]?.project_path).toBe("/work/extra");

    const selectModel = async (model: string) => {
      const panel = page.locator("#models-filter-options");
      if (!(await panel.isVisible())) await page.getByRole("button", { name: /模型筛选/ }).click();
      await page.getByRole("checkbox", { name: model, exact: true }).check();
    };
    const selectProject = async (name: string) => {
      const panel = page.locator("#projects-filter-options");
      if (!(await panel.isVisible())) await page.getByRole("button", { name: /项目筛选/ }).click();
      await page.getByRole("checkbox", { name, exact: true }).check();
    };
    const clearFilters = async () => {
      await page.getByRole("button", { name: "清除筛选" }).click();
      await expect(page.getByRole("button", { name: /模型筛选，全部/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /项目筛选，全部/ })).toBeVisible();
    };
    const modelRequestCount = sessionRequests.length;
    await selectModel("main-model");
    const modelSummary = await summaryFor("year", { models: ["main-model"] });
    await expectRealSummaryCards(page, modelSummary.usage, true);
    expect(sessionRequests.length).toBeGreaterThan(modelRequestCount);
    expect(new URL(sessionRequests.at(-1) ?? "http://127.0.0.1").searchParams.getAll("model")).toEqual(["main-model"]);

    const clearAfterModelRequestCount = sessionRequests.length;
    await clearFilters();
    await expectRealSummaryCards(page, yearSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(clearAfterModelRequestCount);
    const ordinaryProjectRequestCount = sessionRequests.length;
    await selectProject(ordinaryProject.project_name);
    const ordinaryProjectSummary = await summaryFor("year", { projectPaths: ["/work/main"] });
    await expectRealSummaryCards(page, ordinaryProjectSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(ordinaryProjectRequestCount);

    const clearAfterOrdinaryRequestCount = sessionRequests.length;
    await clearFilters();
    await expectRealSummaryCards(page, yearSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(clearAfterOrdinaryRequestCount);
    const projectlessRequestCount = sessionRequests.length;
    await selectProject("无项目会话");
    const projectlessSummary = await summaryFor("year", { projectless: true });
    await expectRealSummaryCards(page, projectlessSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(projectlessRequestCount);

    const clearAfterProjectlessRequestCount = sessionRequests.length;
    await clearFilters();
    await expectRealSummaryCards(page, yearSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(clearAfterProjectlessRequestCount);
    const unknownRequestCount = sessionRequests.length;
    await selectProject("未识别项目");
    const unknownSummary = await summaryFor("year", { unknown: true });
    await expectRealSummaryCards(page, unknownSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(unknownRequestCount);

    const clearAfterUnknownRequestCount = sessionRequests.length;
    await clearFilters();
    await expectRealSummaryCards(page, yearSummary.usage, false);
    expect(sessionRequests.length).toBeGreaterThan(clearAfterUnknownRequestCount);
    const combinedRequestCount = sessionRequests.length;
    await selectModel("main-model");
    await selectProject(ordinaryProject.project_name);
    const combinedSummary = await summaryFor("year", { models: ["main-model"], projectPaths: ["/work/main"] });
    await expectRealSummaryCards(page, combinedSummary.usage, true);
    expect(sessionRequests.length).toBeGreaterThan(combinedRequestCount);
    const combinedRequest = new URL(sessionRequests.at(-1) ?? "http://127.0.0.1").searchParams;
    expect(combinedRequest.getAll("model")).toEqual(["main-model"]);
    expect(combinedRequest.getAll("project_path")).toEqual(["/work/main"]);

    const monthRequestCountBeforeRange = sessionRequests.length;
    await page.getByRole("button", { name: "本月" }).click();
    await expect(page.getByRole("button", { name: /模型筛选，已选1项/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /项目筛选，已选1项/ })).toBeVisible();
    const monthCombinedSummary = await summaryFor("month", { models: ["main-model"], projectPaths: ["/work/main"] });
    await expectRealSummaryCards(page, monthCombinedSummary.usage, true);
    await expect.poll(() => sessionRows.count()).toBeGreaterThan(0);
    expect(await sessionRows.count()).toBeLessThanOrEqual(15);
    expect(sessionRequests.length).toBeGreaterThan(monthRequestCountBeforeRange);
    const monthFirst = await sessionsFor("month", { models: ["main-model"], projectPaths: ["/work/main"] });
    expect(monthFirst.items.length).toBeLessThanOrEqual(60);
    expect(monthFirst).not.toHaveProperty("next_cursor");

    const clearAfterMonthRequestCount = sessionRequests.length;
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.getByRole("button", { name: "本月" })).toHaveClass(/is-selected/);
    await expect(page.getByRole("button", { name: /模型筛选，全部/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /项目筛选，全部/ })).toBeVisible();
    const monthSummary = await summaryFor("month");
    await expectRealSummaryCards(page, monthSummary.usage, false);
    await expect(sessionRows).toHaveCount(15);
    expect(sessionRequests.length).toBeGreaterThan(clearAfterMonthRequestCount);

    for (const requestUrl of sessionRequests) {
      const keys = [...new URL(requestUrl).searchParams.keys()];
      expect(keys.every((key) => ["range", "model", "project_path", "include_projectless", "include_unknown_project", "seed_sort_by", "seed_sort_order"].includes(key))).toBe(true);
      expect(requestUrl).not.toContain("cursor=");
      expect(requestUrl).not.toContain("limit=");
      expect(requestUrl).not.toContain("sort=");
    }
    expect(filterOptionRequests).toHaveLength(1);
  });

  test("renders canonical nullable cache-write as an unknown placeholder", async ({ page }) => {
    await page.route("**/api/usage/summary*", async (route) => {
      let response: { status(): number; headers(): Record<string, string>; json(): Promise<unknown> } | undefined;
      let body: { usage: Record<string, unknown> } | undefined;
      for (let attempt = 0; attempt < 2 && !body; attempt += 1) {
        try {
          response = await route.fetch();
          body = (await response.json()) as { usage: Record<string, unknown> };
        } catch (error) {
          if (attempt === 1 || !String(error).includes("disposed")) throw error;
        }
      }
      if (!response || !body) throw new Error("summary route response was not available");
      body.usage.cache_write_tokens = null;
      body.usage.uncached_input_tokens = null;
      await route.fulfill({ status: response.status(), headers: response.headers(), json: body });
    });
    await page.reload();
    const cards = page.locator(".metric-card");
    await expect(cards).toHaveCount(8);
    await expect(cards.nth(6)).toHaveText(/缓存读取 Token/);
    await expect(cards.nth(7)).toHaveText(/推理 Token/);
  });

  test("honors keyboard focus, reduced motion, forced colors, and 200% zoom operation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch("/api/status");
            const status = await response.json();
            return (
              (status.scan_state === "idle" || status.scan_state === "failed") &&
              status.active_scan_id === null &&
              status.followup === null
            );
          }),
        { timeout: 30_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(true);
    await page.reload();
    const syncButton = page.getByRole("button", { name: "同步数据" });
    let syncFocused = false;
    for (let attempt = 0; attempt < 5 && !syncFocused; attempt += 1) {
      await expect(syncButton).toBeEnabled();
      await syncButton.focus();
      try {
        await expect(syncButton).toBeFocused({ timeout: 250 });
        syncFocused = true;
      } catch {
        // A concurrent revision update may briefly disable the control; retry
        // once its real status returns to idle.
      }
    }
    expect(syncFocused).toBe(true);
    await page.reload();
    const transition = await page.locator(".sync-button").evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(transition).toBe("0s");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const zoomMetrics = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      devicePixelRatio: window.devicePixelRatio,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(zoomMetrics.scale).toBeCloseTo(2, 1);
    expect(zoomMetrics.bodyScrollWidth).toBeLessThanOrEqual(zoomMetrics.viewportWidth);
    await page.getByRole("button", { name: "今天" }).focus();
    await expect(page.getByRole("button", { name: "今天" })).toBeFocused();
    await expect(page.getByRole("button", { name: "同步数据" })).toBeVisible();
    await cdp.detach();
  });

  test("guards network, storage, and error/log disclosure in the real browser", async ({ page }) => {
    const requests: string[] = [];
    const consoleMessages: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("console", (message) => consoleMessages.push(message.text()));
    await page.route("**/api/usage/summary*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "QUERY_FAILED", message: "SQL /private/prompt response JSONL" } }),
      });
    });
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("数据加载失败");
    const secrets = /SQL|private|prompt|JSONL|response/;
    expect(await page.locator("body").innerText()).not.toMatch(secrets);
    expect(consoleMessages.join("\n")).not.toMatch(secrets);
    const guardState = await page.evaluate(() => {
      const browserWindow = window as unknown as { __miniStorageWrites?: number; __miniIndexedDbWrites?: number };
      return {
        storageWrites: browserWindow.__miniStorageWrites ?? 0,
        indexedDbWrites: browserWindow.__miniIndexedDbWrites ?? 0,
        sameOrigin: location.origin,
      };
    });
    expect(guardState.storageWrites).toBe(0);
    expect(guardState.indexedDbWrites).toBe(0);
    const pageOrigin = new URL(page.url()).origin;
    for (const requestUrl of requests) {
      const parsed = new URL(requestUrl);
      expect(parsed.origin).toBe(pageOrigin);
    }
  });

  test("proves direct Axum host, origin, and cross-site guards reject invalid requests", async ({ page }) => {
    const axumBaseUrl = process.env.AXUM_BASE_URL;
    if (!axumBaseUrl) throw new Error("AXUM_BASE_URL is required for direct guard controls");
    const wrongHost = await page.request.get(`${axumBaseUrl}/api/revision`, {
      headers: { Host: "evil.test" },
    });
    const wrongOrigin = await page.request.get(`${axumBaseUrl}/api/revision`, {
      headers: { Host: "127.0.0.1:3210", Origin: "http://evil.test" },
    });
    const crossSite = await page.request.get(`${axumBaseUrl}/api/revision`, {
      headers: { Host: "127.0.0.1:3210", Origin: "http://127.0.0.1:3210", "Sec-Fetch-Site": "cross-site" },
    });
    expect(wrongHost.status()).toBe(403);
    expect(wrongOrigin.status()).toBe(403);
    expect(crossSite.status()).toBe(403);
    await wrongHost.dispose();
    await wrongOrigin.dispose();
    await crossSite.dispose();
  });
});
