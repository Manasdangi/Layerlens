// R4: the layers panel.
import { expect, test, type Page } from "@playwright/test";
import {
  clickEl,
  field,
  frameOf,
  hoverBox,
  hoverEl,
  hoverLabel,
  inspector,
  layers,
  openBoard,
  pagePoint,
  previewFrame,
  ready,
  row,
  rowNames,
  selectedLabels,
  type ScreenName,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await ready(page, "Landing");
});

const list = (page: Page) => layers(page).locator(".layers-list");

/** Makes a preview active without selecting anything: click its page background. */
async function activate(page: Page, name: ScreenName, x = 640, y = 795) {
  const p = await pagePoint(page, name, x, y);
  await page.mouse.click(p.x, p.y);
}

test("R4.1 with no active preview it says so; then it shows the active preview's tree", async ({ page }) => {
  await expect(layers(page)).toContainText("Click something in a preview");
  await activate(page, "Landing");
  await expect.poll(() => rowNames(page)).toEqual(["Top nav", "section#hero", "section.features"]);
});

test("R4.2 rows show indentation, name, and a chevron when there are children", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "Top nav").locator(".chevron").click();
  await expect(row(page, "span.logo")).toBeVisible();
  const pad = async (name: string) => row(page, name).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(await pad("span.logo")).toBeGreaterThan(await pad("Top nav"));
  await expect(row(page, "Top nav").locator(".chevron")).toHaveText("▾");
  await expect(row(page, "section#hero").locator(".chevron")).toHaveText("▸");
  await expect(row(page, "span.logo").locator(".chevron")).toHaveText(""); // only a text node inside
});

test("R4.3 children load on first expand; collapsing and re-expanding never duplicates", async ({ page }) => {
  await activate(page, "Landing");
  const chevron = row(page, "section#hero").locator(".chevron");
  for (let i = 0; i < 5; i++) await chevron.click({ delay: 0 }); // expand, collapse, ... ends expanded
  await expect(row(page, "h1")).toHaveCount(1);
  await expect.poll(() => rowNames(page)).toEqual(["Top nav", "section#hero", "h1", "p", "div.actions", "section.features"]);
});

test("R4.4 hovering a row outlines its element; hovering an element highlights its row (or nearest visible ancestor)", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "Top nav").hover();
  await expect(hoverLabel(page)).toHaveText("Top nav");
  await expect(hoverBox(page)).toHaveCount(1);

  await hoverEl(page, "Landing", "#hero h1");
  await expect(row(page, "section#hero")).toHaveClass(/hovered/); // h1's row is inside a collapsed parent
  await expect(row(page, "h1")).toHaveCount(0); // hover never expands
  await row(page, "section#hero").locator(".chevron").click();
  await hoverEl(page, "Landing", "#hero h1");
  await expect(row(page, "h1")).toHaveClass(/hovered/);
});

test("R4.5 clicking a row selects; selecting in the preview expands, highlights and scrolls to the row", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "Top nav").click();
  await expect(selectedLabels(page)).toHaveText("Top nav");

  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(row(page, "Get started")).toHaveClass(/selected/);
  await expect(row(page, "Get started")).toBeInViewport();
});

test("R4.5 selecting a deeply nested element loads and expands all 30 levels", async ({ page }) => {
  await ready(page, "Settings tree");
  await clickEl(page, "Settings tree", "[data-key=setting-30-1]");
  await expect(selectedLabels(page)).toHaveText("Setting 30.1");
  await expect(row(page, "Setting 30.1")).toHaveClass(/selected/, { timeout: 10_000 });
  await expect(row(page, "Setting 30.1")).toBeInViewport();
  await expect(row(page, "Level 30")).toBeVisible();
});

test("R4.6 clicking a row whose element is out of view scrolls only that page", async ({ page }) => {
  await ready(page, "Dashboard");
  await activate(page, "Dashboard", 640, 30); // the sticky header
  await row(page, "main").locator(".chevron").click();
  const frame = await frameOf(page, "Dashboard");
  const board = (await previewFrame(page, "Dashboard").boundingBox())!;
  expect(await frame.evaluate(() => window.scrollY)).toBe(0);
  await row(page, "Release notes").click();
  await expect.poll(() => frame.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const visible = await frame.locator("[data-name='Release notes']").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });
  expect(visible).toBe(true);
  expect((await previewFrame(page, "Dashboard").boundingBox())!).toEqual(board); // board didn't move
  expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.querySelector(".viewport")!.scrollTop])).toEqual([0, 0, 0]);
});

test("R4.7 shift + click on rows adds and removes; all selected rows are highlighted", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "Top nav").click();
  await row(page, "section.features").click({ modifiers: ["Shift"] });
  await expect(layers(page).locator(".row.selected")).toHaveCount(2);
  await expect(inspector(page)).toContainText("2 elements");
  await row(page, "Top nav").click({ modifiers: ["Shift"] });
  await expect(layers(page).locator(".row.selected")).toHaveCount(1);
});

test("R4.8 keyboard: up / down move, right expands then enters, left collapses then goes to the parent", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "Top nav").click();
  await page.keyboard.press("ArrowDown");
  await expect(selectedLabels(page)).toHaveText("section#hero");
  await page.keyboard.press("ArrowUp");
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await page.keyboard.press("ArrowRight"); // expands
  await expect(row(page, "span.logo")).toBeVisible();
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await page.keyboard.press("ArrowRight"); // first child
  await expect(selectedLabels(page)).toHaveText("span.logo");
  await page.keyboard.press("ArrowLeft"); // collapsed already: to the parent
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await page.keyboard.press("ArrowLeft"); // collapses
  await expect(row(page, "span.logo")).toHaveCount(0);
});

test("R4.9 expanded rows and scroll position are remembered per preview", async ({ page }) => {
  await ready(page, "Settings tree");
  await clickEl(page, "Settings tree", "[data-key=setting-30-1]");
  await expect(row(page, "Setting 30.1")).toBeVisible({ timeout: 10_000 });
  await list(page).evaluate((el) => (el.scrollTop = 300));
  const names = await rowNames(page);

  await activate(page, "Landing");
  await expect.poll(() => rowNames(page)).toContain("Top nav");
  await activate(page, "Settings tree", 1270, 795);

  await expect.poll(() => rowNames(page)).toEqual(names);
  await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBe(300);
});

test("R4.10 the tree follows DOM changes; rows in view don't jump; removed rows disappear", async ({ page }) => {
  await ready(page, "Settings tree");
  await clickEl(page, "Settings tree", "[data-key=setting-30-1]");
  await expect(row(page, "Setting 30.1")).toBeVisible({ timeout: 10_000 });
  await list(page).evaluate((el) => (el.scrollTop = 400));
  const target = row(page, "Level 20");
  const before = (await target.boundingBox())!.y;

  const frame = await frameOf(page, "Settings tree");
  await frame.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const d = document.createElement("div");
      d.dataset.name = `Inserted ${i}`;
      document.body.prepend(d);
    }
  });
  await expect(row(page, "Inserted 0")).toHaveCount(1);
  expect((await target.boundingBox())!.y).toBeCloseTo(before, 0); // holds still
  await expect(row(page, "Setting 30.1")).toHaveClass(/selected/); // selection kept
  await expect(row(page, "Level 30")).toBeVisible(); // expansion kept

  await frame.evaluate(() => document.querySelector("[data-name='Inserted 1']")!.remove());
  await expect(row(page, "Inserted 1")).toHaveCount(0);
});

test("R4.10 the live feed's rows match the page as it re-renders, without duplicates", async ({ page }) => {
  await ready(page, "Activity feed");
  await clickEl(page, "Activity feed", "#feed li .avatar");
  await expect(row(page, "Activity list")).toBeVisible();
  const frame = await frameOf(page, "Activity feed");
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(2000);
    await expect
      .poll(async () => (await rowNames(page)).filter((n) => n === "li").length)
      .toBe(await frame.evaluate(() => document.querySelectorAll("#feed > li").length));
  }
});

test("R4.11 search covers rows never loaded, shows ancestors, keeps selection open, and clearing restores", async ({ page }) => {
  await ready(page, "Settings tree");
  await activate(page, "Settings tree", 1270, 795);
  await expect.poll(() => rowNames(page)).toEqual(["h1", "Settings root"]);
  const search = layers(page).locator("input.search");
  await search.fill("Setting 30.2");
  await expect(row(page, "Setting 30.2")).toBeVisible();
  const names = await rowNames(page);
  expect(names[0]).toBe("Settings root");
  expect(names).toContain("Level 1");
  expect(names).toContain("Level 30");
  expect(names).not.toContain("h1");

  await row(page, "Setting 30.2").click();
  await expect(selectedLabels(page)).toHaveText("Setting 30.2");
  await expect(search).toHaveValue("Setting 30.2");
  await expect(field(page, "Name")).toHaveText("Setting 30.2");

  await search.fill("");
  await expect.poll(() => rowNames(page)).toEqual(["h1", "Settings root"]);
});

test("R4 hovered row element removed: the hover clears", async ({ page }) => {
  await activate(page, "Landing");
  await row(page, "section.features").hover();
  await expect(hoverBox(page)).toHaveCount(1);
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => document.querySelector(".features")!.remove());
  await expect(hoverBox(page)).toHaveCount(0);
  await expect(row(page, "section.features")).toHaveCount(0);
});
