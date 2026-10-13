// R2: hover outlines in Select mode.
import { expect, test } from "@playwright/test";
import {
  elementRect,
  emptySpaceRightOf,
  expectBoxOn,
  frameOf,
  hoverBox,
  hoverEl,
  hoverLabel,
  openBoard,
  pagePoint,
  ready,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await ready(page, "Landing");
});

test("R2.1 a 1px outline exactly on the element's box, with its name", async ({ page }) => {
  await hoverEl(page, "Landing", "[data-key=cta-primary]");
  await expect(hoverLabel(page)).toHaveText("Get started");
  await expectBoxOn(hoverBox(page), page, "Landing", "[data-key=cta-primary]");
  expect(await hoverBox(page).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
});

test("R2.1 names follow the rule: data-name, tag.class, tag#id, tag", async ({ page }) => {
  await hoverEl(page, "Landing", "nav");
  await expect(hoverLabel(page)).toHaveText("Top nav");
  await hoverEl(page, "Landing", ".logo");
  await expect(hoverLabel(page)).toHaveText("span.logo");
  await hoverEl(page, "Landing", "#hero h1");
  await expect(hoverLabel(page)).toHaveText("h1");
  await hoverEl(page, "Landing", "#crash");
  await expect(hoverLabel(page)).toHaveText("button.ghost"); // class wins over id
});

test("R2.2 only one element on the whole board is hovered", async ({ page }) => {
  await ready(page, "Sign up");
  await hoverEl(page, "Landing", "#hero h1");
  await hoverEl(page, "Sign up", "h1");
  await expect(hoverBox(page)).toHaveCount(1);
  await expect(hoverLabel(page)).toHaveText("h1");
});

test("R2.3 hover clears when the pointer leaves the preview", async ({ page }) => {
  await hoverEl(page, "Landing", "#hero h1");
  await expect(hoverBox(page)).toHaveCount(1);
  const p = await emptySpaceRightOf(page, "Landing");
  await page.mouse.move(p.x, p.y);
  await expect(hoverBox(page)).toHaveCount(0);
});

test("R2.3 hover clears when the board pans or zooms", async ({ page }) => {
  await hoverEl(page, "Landing", "#hero h1");
  await expect(hoverBox(page)).toHaveCount(1);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  await expect(hoverBox(page)).toHaveCount(0);
});

test("R2.3 hover clears when the pointer leaves the window", async ({ page }) => {
  await hoverEl(page, "Landing", "#hero h1");
  await expect(hoverBox(page)).toHaveCount(1);
  await page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave")));
  await expect(hoverBox(page)).toHaveCount(0);
});

test("R2.4 disabled buttons, inputs, SVG are hoverable", async ({ page }) => {
  await ready(page, "Sign up");
  await ready(page, "Dashboard");
  await hoverEl(page, "Sign up", "[data-key=signup-submit]");
  await expect(hoverLabel(page)).toHaveText("Create account");
  await hoverEl(page, "Sign up", "#email");
  await expect(hoverLabel(page)).toHaveText("input#email");
  await hoverEl(page, "Dashboard", "[data-key=icon-search]");
  await expect(hoverLabel(page)).toHaveText("Search icon");
});

test("R2.4 elements that passed under the sticky header are hoverable where visible", async ({ page }) => {
  await ready(page, "Dashboard");
  const frame = await frameOf(page, "Dashboard");
  await frame.evaluate(() => window.scrollTo(0, 120)); // the stats panel slides under the header
  const header = await elementRect(page, "Dashboard", "header");
  const stats = await elementRect(page, "Dashboard", "[data-key=stat-revenue]");
  expect(stats.y).toBeLessThan(header.y + header.height); // partly under the header
  const p = { x: stats.x + stats.width / 2, y: stats.y + stats.height - 2 }; // its visible part
  expect(p.y).toBeGreaterThan(header.y + header.height);
  await page.mouse.move(p.x, p.y);
  await expect(hoverLabel(page)).not.toHaveText("Sticky header");
  await expect(hoverLabel(page)).toHaveText(/div\.(stat|label|value)/);
});

test("R2.5 page background (html / body) is never hovered", async ({ page }) => {
  await ready(page, "Sign up");
  const p = await pagePoint(page, "Sign up", 10, 10); // corner of the page: body only
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  await expect(hoverBox(page)).toHaveCount(0);
});
