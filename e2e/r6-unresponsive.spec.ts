// R6: a page that connected and then stops answering fails its preview (README
// decision), reported once. The test serves the real bridge behind a switch that
// lets it go mute after the handshake: the page stays loaded but never answers.
import { expect, test } from "@playwright/test";
import { SCREEN_ID, clickEl, frameOf, openBoard, preview, ready, selectedLabels, type Report } from "./helpers";

const MUTE_SWITCH = `(() => {
  const add = window.addEventListener;
  window.addEventListener = function (type, fn, opts) {
    if (type !== "message") return add.call(this, type, fn, opts);
    return add.call(this, type, (e) => { if (!window.__figrMute) fn.call(this, e); }, opts);
  };
})();\n`;

test.beforeEach(async ({ page }) => {
  await page.route("**/figr-bridge.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: MUTE_SWITCH + (await res.text()) });
  });
});

async function setup(page: import("@playwright/test").Page) {
  const reports: Report[] = await openBoard(page);
  await ready(page, "Landing");
  await ready(page, "Sign up");
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => ((window as unknown as { __figrMute: boolean }).__figrMute = true));
  return reports;
}

test("hovering a page that stopped answering fails that preview only, reported once", async ({ page }) => {
  const reports = await setup(page);
  await clickEl(page, "Sign up", "h1"); // another preview works
  await expect(selectedLabels(page)).toHaveText("h1");

  const box = (await preview(page, "Landing").locator(".preview-frame").boundingBox())!;
  for (let i = 0; i < 5; i++) await page.mouse.move(box.x + 50 + i * 10, box.y + 50); // several hit tests time out
  await expect(preview(page, "Landing").getByRole("alert")).toContainText("This preview hit an error", { timeout: 5_000 });
  await page.waitForTimeout(1500);
  expect(reports).toEqual([{ region: "preview", screenId: SCREEN_ID.Landing }]);
  await expect(page.locator("[role=alert]")).toHaveCount(1);

  // Retry reloads the preview, which answers again.
  await preview(page, "Landing").getByRole("button", { name: "Retry" }).click();
  await ready(page, "Landing");
  await clickEl(page, "Landing", "#hero h1");
  await expect(selectedLabels(page)).toHaveText("h1");
});

test("a keyboard step the page doesn't answer fails that preview", async ({ page }) => {
  const reports = await openBoard(page);
  await ready(page, "Landing");
  await clickEl(page, "Landing", ".logo");
  await expect(selectedLabels(page)).toHaveText("span.logo");
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => ((window as unknown as { __figrMute: boolean }).__figrMute = true));
  await page.keyboard.press("Tab");
  await expect(preview(page, "Landing").getByRole("alert")).toContainText("This preview hit an error", { timeout: 5_000 });
  await page.waitForTimeout(800);
  expect(reports).toEqual([{ region: "preview", screenId: SCREEN_ID.Landing }]);
});
