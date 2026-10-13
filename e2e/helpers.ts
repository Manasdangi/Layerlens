import { expect, type Frame, type Locator, type Page } from "@playwright/test";

/** Screens in board order (backend/data/screens.json): the first six use pages 1..6. */
export const SCREENS = ["Landing", "Sign up", "Dashboard", "Activity feed", "Settings tree", "Docs"] as const;
export type ScreenName = (typeof SCREENS)[number];
export const SCREEN_ID: Record<ScreenName, string> = {
  Landing: "scr-01",
  "Sign up": "scr-02",
  Dashboard: "scr-03",
  "Activity feed": "scr-04",
  "Settings tree": "scr-05",
  Docs: "scr-06",
};

export const preview = (page: Page, name: ScreenName) => page.locator(".preview").nth(SCREENS.indexOf(name));
export const previewFrame = (page: Page, name: ScreenName) => preview(page, name).locator(".preview-frame");

export interface Report {
  region: string;
  screenId: string | null;
  elementKey?: string;
}

/** Opens the board and collects every report() call from the app's console. */
export async function openBoard(page: Page) {
  const reports: Report[] = [];
  page.on("console", async (msg) => {
    if (!msg.text().startsWith("[report #")) return;
    const ctx = await msg
      .args()[1]
      ?.evaluate((o: Report) => ({ region: o.region, screenId: o.screenId, ...(o.elementKey ? { elementKey: o.elementKey } : {}) }))
      .catch(() => null);
    if (ctx) reports.push(ctx);
  });
  await page.goto("/");
  await expect(page.locator(".preview")).toHaveCount(24);
  return reports;
}

/** Waits for a preview's page script to finish the handshake. */
export async function ready(page: Page, name: ScreenName) {
  await expect(previewFrame(page, name).locator(".preview-status")).toHaveCount(0, { timeout: 10_000 });
}

export async function frameOf(page: Page, name: ScreenName): Promise<Frame> {
  const handle = await previewFrame(page, name).locator("iframe").elementHandle();
  const frame = await handle!.contentFrame();
  return frame!;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An element's box on screen: its box in the page, scaled and offset by the board. */
export async function elementRect(page: Page, name: ScreenName, selector: string): Promise<ScreenRect> {
  const frame = await frameOf(page, name);
  const r = await frame.locator(selector).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const box = (await previewFrame(page, name).boundingBox())!;
  const z = box.width / 1280;
  return { x: box.x + r.x * z, y: box.y + r.y * z, width: r.w * z, height: r.h * z };
}

export const center = (r: ScreenRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A point given in page pixels of a preview, on screen. */
export async function pagePoint(page: Page, name: ScreenName, x: number, y: number) {
  const box = (await previewFrame(page, name).boundingBox())!;
  const z = box.width / 1280;
  return { x: box.x + x * z, y: box.y + y * z };
}

export async function hoverEl(page: Page, name: ScreenName, selector: string) {
  const p = center(await elementRect(page, name, selector));
  await page.mouse.move(p.x, p.y);
  return p;
}

export async function clickEl(page: Page, name: ScreenName, selector: string, opts: { shift?: boolean } = {}) {
  const p = center(await elementRect(page, name, selector));
  if (opts.shift) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  if (opts.shift) await page.keyboard.up("Shift");
  return p;
}

/** Asserts a screen box matches an element's box within a pixel. */
export async function expectBoxOn(locator: Locator, page: Page, name: ScreenName, selector: string) {
  await expect
    .poll(async () => {
      const a = await locator.boundingBox();
      const b = await elementRect(page, name, selector);
      if (!a) return "no outline";
      const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
      return d <= 1.5 ? "match" : `off by ${d.toFixed(1)}px`;
    })
    .toBe("match");
}

export const hoverBox = (page: Page) => page.locator(".ov-box.hover");
export const hoverLabel = (page: Page) => page.locator(".ov-label.hover");
export const selectedBoxes = (page: Page) => page.locator(".ov-box.selected");
export const selectedLabels = (page: Page) => page.locator(".ov-label.selected");

export const inspector = (page: Page) => page.locator(".inspector-panel");
export const field = (page: Page, label: string) =>
  inspector(page)
    .locator(".prop")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");

export const layers = (page: Page) => page.locator(".layers-panel");
export const rows = (page: Page) => layers(page).locator(".row");
export const row = (page: Page, name: string) =>
  rows(page).filter({ has: page.locator(".row-name", { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
export const rowNames = (page: Page) => layers(page).locator(".row .row-name").allTextContents();

export const modeButton = (page: Page, mode: "Select" | "Interact") => page.getByRole("button", { name: new RegExp(`^${mode}`) });

export async function devMenu(page: Page, fn: () => Promise<void>) {
  await page.getByRole("button", { name: "Dev faults" }).click();
  await fn();
  await page.getByRole("button", { name: "Dev faults" }).click();
}

export const devCheckbox = (page: Page, name: RegExp) => page.locator(".dev-menu").getByRole("checkbox", { name });

/** Empty board space: the gap to the right of a preview. */
export async function emptySpaceRightOf(page: Page, name: ScreenName) {
  const box = (await previewFrame(page, name).boundingBox())!;
  return { x: box.x + box.width + 15, y: box.y + box.height / 2 };
}

export async function zoomLabel(page: Page) {
  return Number((await page.locator(".zoom").textContent())!.replace("%", ""));
}

export function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Waits a moment, then checks the reports collected so far. */
export async function settle(page: Page, ms = 500) {
  await page.waitForTimeout(ms);
}
