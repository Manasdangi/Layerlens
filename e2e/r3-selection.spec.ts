// R3: selection, outlines that stay glued, keyboard, re-renders, navigation.
import { expect, test } from "@playwright/test";
import {
  clickEl,
  elementRect,
  emptySpaceRightOf,
  expectBoxOn,
  field,
  frameOf,
  inspector,
  modeButton,
  openBoard,
  pagePoint,
  previewFrame,
  ready,
  rowNames,
  selectedBoxes,
  selectedLabels,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await ready(page, "Landing");
});

test("R3.1 click selects: a 2px outline in a different colour from hover, plus a label", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(selectedLabels(page)).toHaveText("Get started");
  await expectBoxOn(selectedBoxes(page), page, "Landing", "[data-key=cta-primary]");
  const sel = await selectedBoxes(page).evaluate((el) => getComputedStyle(el));
  expect(sel.borderTopWidth).toBe("2px");
  // Hover something else to compare colours.
  const p = center(await elementRect(page, "Landing", "#hero h1"));
  await page.mouse.move(p.x, p.y);
  const hoverColor = await page.locator(".ov-box.hover").evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(hoverColor).not.toBe(sel.borderTopColor);
});

const center = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test("R3.2 shift + click adds and removes in the same preview; in another preview it replaces", async ({ page }) => {
  await ready(page, "Sign up");
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await clickEl(page, "Landing", "#crash", { shift: true });
  await expect(selectedBoxes(page)).toHaveCount(2);
  await expect(inspector(page)).toContainText("2 elements");
  await clickEl(page, "Landing", "#crash", { shift: true });
  await expect(selectedBoxes(page)).toHaveCount(1);
  await clickEl(page, "Sign up", "h1", { shift: true });
  await expect(selectedBoxes(page)).toHaveCount(1);
  await expect(field(page, "Text")).toHaveText("Create your account");
});

test("R3.3 Escape, page background and empty board space clear the selection", async ({ page }) => {
  await ready(page, "Sign up");
  await clickEl(page, "Landing", "#hero h1");
  await page.keyboard.press("Escape");
  await expect(selectedBoxes(page)).toHaveCount(0);

  await clickEl(page, "Sign up", "h1");
  const bg = await pagePoint(page, "Sign up", 10, 10);
  await page.mouse.click(bg.x, bg.y);
  await expect(selectedBoxes(page)).toHaveCount(0);

  await clickEl(page, "Landing", "#hero h1");
  const empty = await emptySpaceRightOf(page, "Landing");
  await page.mouse.click(empty.x, empty.y);
  await expect(selectedBoxes(page)).toHaveCount(0);
});

test("R3.4 outlines stay glued while panning and zooming, and stay 2px with the same label size", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  const labelHeight = (await selectedLabels(page).boundingBox())!.height;
  const empty = await emptySpaceRightOf(page, "Landing");
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.wheel(30, 40);
  await expectBoxOn(selectedBoxes(page), page, "Landing", "[data-key=cta-primary]");

  const p = await pagePoint(page, "Landing", 300, 380);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -150);
  await page.keyboard.up("Control");
  await expectBoxOn(selectedBoxes(page), page, "Landing", "[data-key=cta-primary]");
  expect(await selectedBoxes(page).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("2px");
  expect((await selectedLabels(page).boundingBox())!.height).toBeCloseTo(labelHeight, 0);
});

test("R3.4 outlines follow page scroll and scroll areas; fully scrolled out = no outline but still selected", async ({ page }) => {
  await ready(page, "Dashboard");
  await clickEl(page, "Dashboard", "[data-key=order-1001]"); // lands on a cell
  await expect(selectedLabels(page)).toHaveText("td");
  await page.keyboard.press("Shift+Enter"); // up to the row
  await expect(selectedLabels(page)).toHaveText("tr");
  const frame = await frameOf(page, "Dashboard");

  await frame.evaluate(() => window.scrollTo(0, 60));
  await expectBoxOn(selectedBoxes(page), page, "Dashboard", "[data-key=order-1001]");

  await frame.evaluate(() => (document.querySelector(".scroll-area")!.scrollTop = 30));
  await expectBoxOn(selectedBoxes(page), page, "Dashboard", "[data-key=order-1001]");

  await frame.evaluate(() => (document.querySelector(".scroll-area")!.scrollTop = 10_000));
  await expect(selectedBoxes(page)).toHaveCount(0);
  await expect(field(page, "Text")).toContainText("#1001");
});

test("R3.4 outlines follow an element that changes size", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => ((document.querySelector("[data-key=cta-primary]") as HTMLElement).style.padding = "40px 80px"));
  await expectBoxOn(selectedBoxes(page), page, "Landing", "[data-key=cta-primary]");
});

test("R3.4 outlines are clipped to the preview's edges", async ({ page }) => {
  await clickEl(page, "Landing", "nav");
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => window.scrollTo(0, 20)); // nav is now partly above the page's top
  const clip = page.locator(".ov-clip").first();
  const preview = (await previewFrame(page, "Landing").boundingBox())!;
  await expect.poll(async () => (await clip.boundingBox())!.y).toBeGreaterThanOrEqual(preview.y - 0.5);
});

test("R3.4 the label goes below the element when there's no room above it", async ({ page }) => {
  await ready(page, "Dashboard");
  await clickEl(page, "Dashboard", "header .brand");
  await expect(selectedLabels(page)).toHaveText("div.brand");
  const box = (await selectedBoxes(page).boundingBox())!;
  const label = (await selectedLabels(page).boundingBox())!;
  expect(label.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
});

test("R3.5 Enter selects the first child, Shift+Enter the parent, Tab / Shift+Tab siblings (wrapping)", async ({ page }) => {
  await clickEl(page, "Landing", ".logo");
  await expect(selectedLabels(page)).toHaveText("span.logo");
  await page.keyboard.press("Shift+Enter");
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await page.keyboard.press("Shift+Enter"); // top level: nothing happens
  await page.waitForTimeout(200);
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await page.keyboard.press("Enter");
  await expect(selectedLabels(page)).toHaveText("span.logo");
  await page.keyboard.press("Tab");
  await expect(selectedLabels(page)).toHaveText("ul");
  await page.keyboard.press("Tab"); // wraps
  await expect(selectedLabels(page)).toHaveText("span.logo");
  await page.keyboard.press("Shift+Tab"); // wraps backwards
  await expect(selectedLabels(page)).toHaveText("ul");
});

test("R3.5 with several selected, keys act on the most recent and replace the selection", async ({ page }) => {
  await clickEl(page, "Landing", "#hero h1");
  await clickEl(page, "Landing", ".logo", { shift: true });
  await expect(selectedBoxes(page)).toHaveCount(2);
  await page.keyboard.press("Tab");
  await expect(selectedBoxes(page)).toHaveCount(1);
  await expect(selectedLabels(page)).toHaveText("ul");
});

test("R3.6 shortcuts work right after clicking inside a preview", async ({ page }) => {
  await modeButton(page, "Select").click(); // a host button had focus
  await clickEl(page, "Landing", ".logo");
  await page.keyboard.press("Tab");
  await expect(selectedLabels(page)).toHaveText("ul");
  await page.keyboard.press("i");
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
});

test("R3.7 a selected element survives the page rebuilding its DOM and inserting siblings before it", async ({ page }) => {
  await ready(page, "Activity feed");
  const frame = await frameOf(page, "Activity feed");
  // A keyed item and an unkeyed one ("Ns ago" changes every render).
  const key = await frame.locator("li[data-key]").first().getAttribute("data-key");
  await clickEl(page, "Activity feed", `li[data-key="${key}"] .avatar`);
  await expect(selectedLabels(page)).toHaveText("span.avatar");
  await page.keyboard.press("Shift+Enter"); // up to the list item
  await expect(selectedLabels(page)).toHaveText("li");
  const text = (await field(page, "Text").textContent())!.replace(/\d+[sm] ago/, "");
  await page.waitForTimeout(4500); // two re-renders, each inserting a new item at the top
  await expect(selectedBoxes(page)).toHaveCount(1);
  await expectBoxOn(selectedBoxes(page), page, "Activity feed", `li[data-key="${key}"]`);
  expect((await field(page, "Text").textContent())!.replace(/\d+[sm] ago/, "")).toBe(text);
});

test("R3.7 an unkeyed element survives re-renders and its live text updates", async ({ page }) => {
  await ready(page, "Activity feed");
  const frame = await frameOf(page, "Activity feed");
  const li = frame.locator("li:not([data-key])").first();
  const who = await li.locator("b").textContent();
  const what = await li.locator(".tag").textContent();
  await clickEl(page, "Activity feed", "li:not([data-key]) .time");
  await expect(selectedLabels(page)).toHaveText("span.time");
  const before = await field(page, "Text").textContent();
  await page.waitForTimeout(4500);
  await expect(selectedBoxes(page)).toHaveCount(1);
  await expect(field(page, "Text")).not.toHaveText(before!);
  // Still the same item: find it by its (unchanging) words and compare boxes.
  const index = await frame.evaluate(
    ([w, t]) => [...document.querySelectorAll("#feed li")].findIndex((x) => x.querySelector("b")?.textContent === w && x.querySelector(".tag")?.textContent === t),
    [who, what],
  );
  expect(index).toBeGreaterThan(0);
  await expectBoxOn(selectedBoxes(page), page, "Activity feed", `#feed li:nth-child(${index + 1}) .time`);
});

test("R3.7 a selected element that no longer exists leaves the selection", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await clickEl(page, "Landing", "#crash", { shift: true });
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => document.querySelector("[data-key=cta-primary]")!.remove());
  await expect(selectedBoxes(page)).toHaveCount(1);
  await frame.evaluate(() => document.querySelector("#crash")!.remove());
  await expect(selectedBoxes(page)).toHaveCount(0);
  await expect(inspector(page)).toContainText("This element no longer exists");
  // Until the next selection.
  await clickEl(page, "Landing", "#hero h1");
  await expect(inspector(page)).not.toContainText("This element no longer exists");
});

test("R3.8 navigating clears that preview's selection; Select mode and layers work on the new page", async ({ page }) => {
  await ready(page, "Docs");
  await clickEl(page, "Docs", "a.next");
  await expect(selectedLabels(page)).toHaveText("Next page link");
  await expect.poll(() => rowNames(page)).toContain("Docs sidebar");

  await page.keyboard.press("i");
  await clickEl(page, "Docs", "a.next");
  const frame = await frameOf(page, "Docs");
  await expect.poll(() => frame.url()).toContain("page-6-next.html");
  await expect(inspector(page)).toContainText("Select an element to inspect it");
  await ready(page, "Docs");
  await expect.poll(() => rowNames(page)).not.toContain("Docs sidebar");
  await expect.poll(() => rowNames(page)).toContain("article");

  await page.keyboard.press("v");
  await expect(selectedBoxes(page)).toHaveCount(0);
  await clickEl(page, "Docs", "[data-key=config-region] td:nth-child(2)");
  await expect(selectedLabels(page)).toHaveText("td");
  await expect(field(page, "Text")).toHaveText("us-east");
});

test("Tab on a focused toolbar button moves focus, not the selection", async ({ page }) => {
  await clickEl(page, "Landing", ".logo");
  await modeButton(page, "Select").focus();
  await page.keyboard.press("Tab");
  await expect(modeButton(page, "Interact")).toBeFocused();
  await expect(selectedLabels(page)).toHaveText("span.logo");
});
