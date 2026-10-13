// R1: board, pan, zoom, page scroll, Select / Interact modes.
import { expect, test } from "@playwright/test";
import {
  clickEl,
  elementRect,
  emptySpaceRightOf,
  frameOf,
  hoverBox,
  modeButton,
  openBoard,
  pagePoint,
  preview,
  previewFrame,
  ready,
  selectedBoxes,
  zoomLabel,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test("R1.1 shows every screen as a 1280x800 preview with its name above", async ({ page }) => {
  const names = await page.locator(".preview-title > span:first-child").allTextContents();
  expect(names).toHaveLength(24);
  expect(names.slice(0, 6)).toEqual(["Landing", "Sign up", "Dashboard", "Activity feed", "Settings tree", "Docs"]);
  const iframe = previewFrame(page, "Landing").locator("iframe");
  await expect(iframe).toHaveAttribute("width", "1280");
  await expect(iframe).toHaveAttribute("height", "800");
  // The title sits above the preview.
  const title = (await preview(page, "Landing").locator(".preview-title").boundingBox())!;
  const frame = (await previewFrame(page, "Landing").boundingBox())!;
  expect(title.y + title.height).toBeLessThanOrEqual(frame.y + 1);
});

test("R1.2 dragging empty board space pans", async ({ page }) => {
  const before = (await previewFrame(page, "Landing").boundingBox())!;
  const p = await emptySpaceRightOf(page, "Landing");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 60, p.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = (await previewFrame(page, "Landing").boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(40, 0);
});

test("R1.2 the wheel over empty board space pans", async ({ page }) => {
  const before = (await previewFrame(page, "Landing").boundingBox())!;
  const p = await emptySpaceRightOf(page, "Landing");
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await previewFrame(page, "Landing").boundingBox())!.y).toBeCloseTo(before.y - 100, 0);
});

test("R1.3 Ctrl + wheel zooms between 25% and 400%, centred on the pointer, also over a preview", async ({ page }) => {
  await ready(page, "Landing");
  expect(await zoomLabel(page)).toBe(25);
  const p = await pagePoint(page, "Landing", 400, 300); // over a preview, in Select mode
  await page.mouse.move(p.x, p.y);
  const before = (await previewFrame(page, "Landing").boundingBox())!;
  const fx = (p.x - before.x) / before.width;
  const fy = (p.y - before.y) / before.height;

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomLabel(page)).toBeGreaterThan(25);
  // The point under the pointer stays put.
  const after = (await previewFrame(page, "Landing").boundingBox())!;
  expect(after.x + fx * after.width).toBeCloseTo(p.x, 0);
  expect(after.y + fy * after.height).toBeCloseTo(p.y, 0);

  // Clamped at both ends.
  await page.keyboard.down("Control");
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200);
  await expect.poll(() => zoomLabel(page)).toBe(400);
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomLabel(page)).toBe(25);
});

test("R1.3 Ctrl + wheel over a preview zooms in Interact mode too", async ({ page }) => {
  await ready(page, "Landing");
  await page.keyboard.press("i");
  const p = await pagePoint(page, "Landing", 400, 300);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => zoomLabel(page)).toBeGreaterThan(25);
});

for (const mode of ["select", "interact"] as const) {
  test(`R1.4 the wheel over a preview scrolls that page, not the board (${mode} mode)`, async ({ page }) => {
    await ready(page, "Dashboard");
    if (mode === "interact") await page.keyboard.press("i");
    const frame = await frameOf(page, "Dashboard");
    const boardBefore = (await previewFrame(page, "Dashboard").boundingBox())!;
    const p = await pagePoint(page, "Dashboard", 640, 150); // over the stats panel
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => frame.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await previewFrame(page, "Dashboard").boundingBox())!.y).toBeCloseTo(boardBefore.y, 0);
  });
}

test("R1.4 the wheel over a scroll area inside the page scrolls that area", async ({ page }) => {
  await ready(page, "Dashboard");
  const frame = await frameOf(page, "Dashboard");
  const area = await elementRect(page, "Dashboard", ".scroll-area");
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => frame.evaluate(() => document.querySelector(".scroll-area")!.scrollTop)).toBeGreaterThan(0);
});

test("R1.5 the toolbar and the V / I keys switch modes", async ({ page }) => {
  await expect(modeButton(page, "Select")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("i");
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(modeButton(page, "Select")).toHaveAttribute("aria-pressed", "true");
  await modeButton(page, "Interact").click();
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
  await modeButton(page, "Select").click();
  await expect(modeButton(page, "Select")).toHaveAttribute("aria-pressed", "true");
});

test("R1.5 Select mode: links don't navigate, inputs don't get focus, buttons don't act", async ({ page }) => {
  await ready(page, "Docs");
  await ready(page, "Sign up");
  await ready(page, "Landing");
  const docs = await frameOf(page, "Docs");
  await clickEl(page, "Docs", "a.next");
  await page.waitForTimeout(500);
  expect(docs.url()).toContain("page-6.html");

  const signup = await frameOf(page, "Sign up");
  await clickEl(page, "Sign up", "#full-name");
  await page.waitForTimeout(200);
  expect(await signup.evaluate(() => document.activeElement?.id ?? "")).not.toBe("full-name");

  // "Watch demo" throws when it acts; in Select mode it must not.
  await clickEl(page, "Landing", "#crash");
  await page.waitForTimeout(300);
  await expect(preview(page, "Landing").locator(".page-error")).toHaveCount(0);
});

test("R1.5 Interact mode: the page behaves normally and no outlines are drawn", async ({ page }) => {
  await ready(page, "Sign up");
  await clickEl(page, "Sign up", "h1");
  await expect(selectedBoxes(page)).toHaveCount(1);
  await page.keyboard.press("i");
  await expect(selectedBoxes(page)).toHaveCount(0); // kept, but hidden

  const signup = await frameOf(page, "Sign up");
  await clickEl(page, "Sign up", "#full-name");
  await expect.poll(() => signup.evaluate(() => document.activeElement?.id)).toBe("full-name");
  await page.keyboard.type("Ada");
  expect(await signup.evaluate(() => (document.getElementById("full-name") as HTMLInputElement).value)).toBe("Ada");
  await expect(hoverBox(page)).toHaveCount(0);

});

test("R3.6 shortcuts work right after clicking inside a preview in Interact mode", async ({ page }) => {
  await ready(page, "Sign up");
  await clickEl(page, "Sign up", "h1");
  await page.keyboard.press("i");
  const signup = await frameOf(page, "Sign up");
  await clickEl(page, "Sign up", "p.sub"); // the page now has keyboard focus
  await expect.poll(() => signup.evaluate(() => document.hasFocus())).toBe(true);
  await page.keyboard.press("Escape"); // forwarded by the page: clears the selection
  await page.keyboard.press("v"); // forwarded: back to Select mode
  await expect(modeButton(page, "Select")).toHaveAttribute("aria-pressed", "true");
  await expect(selectedBoxes(page)).toHaveCount(0);
  await expect(page.locator(".inspector-panel")).toContainText("Select an element");
});

test("R1.5 the selection reappears when switching back to Select mode", async ({ page }) => {
  await ready(page, "Sign up");
  await clickEl(page, "Sign up", "h1");
  await page.keyboard.press("i");
  await expect(selectedBoxes(page)).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(selectedBoxes(page)).toHaveCount(1);
});
