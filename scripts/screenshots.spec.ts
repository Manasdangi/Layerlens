// Captures the README screenshots from the running app: `npm run screenshots`.
// Writes docs/screenshots/*.png.
import { expect, test, type Page } from "@playwright/test";
import {
  clickEl,
  devCheckbox,
  devMenu,
  field,
  hoverEl,
  hoverLabel,
  openBoard,
  pagePoint,
  preview,
  ready,
  row,
  type ScreenName,
} from "../e2e/helpers";

const OUT = "docs/screenshots";

test.use({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 2 });

/** Zooms the board in from 25%: each step is about 1.8x. */
async function zoomIn(page: Page, steps: number) {
  const view = (await page.locator(".viewport").boundingBox())!;
  await page.mouse.move(view.x + 10, view.y + 10);
  await page.keyboard.down("Control");
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -60);
  await page.keyboard.up("Control");
}

/** Pans (wheel over empty board) so a preview's top-left sits at (left, top) in the board viewport. */
async function panTo(page: Page, name: ScreenName, left: number, top: number) {
  const view = (await page.locator(".viewport").boundingBox())!;
  await page.mouse.move(view.x + 4, view.y + 4);
  for (let i = 0; i < 4; i++) {
    const box = (await preview(page, name).boundingBox())!;
    const dx = box.x - (view.x + left);
    const dy = box.y - (view.y + top);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(150);
  }
}

test("overview: select, hover, layers and inspector", async ({ page }) => {
  await openBoard(page);
  await ready(page, "Landing");
  await zoomIn(page, 2);
  await panTo(page, "Landing", 40, 40);
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(field(page, "Component")).toHaveText("Button");
  await hoverEl(page, "Landing", "[data-key=feature-sync] h3");
  await expect(hoverLabel(page)).toHaveText("h3");
  await page.screenshot({ path: `${OUT}/overview.png` });
});

test("deep tree: a leaf 30 levels down, revealed in the layers panel", async ({ page }) => {
  await openBoard(page);
  await ready(page, "Settings tree");
  await zoomIn(page, 2);
  await panTo(page, "Settings tree", 40, 40);
  await clickEl(page, "Settings tree", "[data-key=setting-30-2]");
  await expect(row(page, "Setting 30.2")).toBeInViewport({ timeout: 10_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/deep-tree.png` });
});

test("failures: each region fails on its own, with Retry", async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page);
  await ready(page, "Landing");
  await ready(page, "Sign up");
  await ready(page, "Docs");
  // Landing's page script goes silent (connect timeout); GET /elements fails.
  const bg = await pagePoint(page, "Landing", 640, 795);
  await page.mouse.click(bg.x, bg.y);
  await devMenu(page, async () => {
    await devCheckbox(page, /Bridge stays silent/).check();
    await devCheckbox(page, /GET \/elements fails/).check();
  });
  await zoomIn(page, 1);
  await panTo(page, "Landing", 30, 40);
  await clickEl(page, "Sign up", "[data-key=signup-submit]");
  await expect(page.locator(".inspector-panel").getByRole("alert")).toBeVisible();
  await expect(preview(page, "Landing").getByRole("alert")).toBeVisible({ timeout: 15_000 });
  // Docs rejects a promise after 4s: the Page error badge, with its message on hover.
  const badge = preview(page, "Docs").locator(".page-error");
  await expect(badge).toBeVisible({ timeout: 8_000 });
  await badge.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/failures.png` });
});
