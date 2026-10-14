// Resizable side panels: drag the handle between a panel and the board.
import { expect, test, type Page } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

const width = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!.width;
const splitter = (page: Page, name: string) => page.getByRole("separator", { name });

async function drag(page: Page, name: string, dx: number) {
  const box = (await splitter(page, name).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 }); // crosses previews (iframes) on the way
  await page.mouse.up();
}

test("dragging resizes the layers panel and the board takes the space", async ({ page }) => {
  expect(await width(page, ".layers-panel")).toBe(280);
  const board = await width(page, ".viewport");
  await drag(page, "Resize layers panel", -60);
  expect(await width(page, ".layers-panel")).toBe(220);
  expect(await width(page, ".viewport")).toBeCloseTo(board + 60, 0);
  await drag(page, "Resize layers panel", 120);
  expect(await width(page, ".layers-panel")).toBe(340);
});

test("dragging the inspector's handle left widens it", async ({ page }) => {
  expect(await width(page, ".inspector-panel")).toBe(300);
  await drag(page, "Resize inspector", -100);
  expect(await width(page, ".inspector-panel")).toBe(400);
});

test("widths stay between 200 and 480px; double-click resets", async ({ page }) => {
  await drag(page, "Resize layers panel", -500);
  expect(await width(page, ".layers-panel")).toBe(200);
  await drag(page, "Resize layers panel", 800);
  expect(await width(page, ".layers-panel")).toBe(480);
  await splitter(page, "Resize layers panel").dblclick();
  expect(await width(page, ".layers-panel")).toBe(280);
});

test("the keyboard resizes too: arrows step 16px, Enter resets", async ({ page }) => {
  await splitter(page, "Resize inspector").focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(page, ".inspector-panel")).toBe(316);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(page, ".inspector-panel")).toBe(284);
  await page.keyboard.press("Enter");
  await expect.poll(() => width(page, ".inspector-panel")).toBe(300);
  await expect(splitter(page, "Resize inspector")).toHaveAttribute("aria-valuenow", "300");
});
