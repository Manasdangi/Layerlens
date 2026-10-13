// R6: failures stay in their region, show Retry, and reach report() exactly once.
// Every fault is triggered from the Dev faults menu, as in the video.
import { expect, test, type Page } from "@playwright/test";
import {
  SCREEN_ID,
  clickEl,
  devCheckbox,
  devMenu,
  field,
  inspector,
  layers,
  openBoard,
  pagePoint,
  preview,
  ready,
  row,
  selectedLabels,
  type Report,
} from "./helpers";

let reports: Report[];

test.beforeEach(async ({ page }) => {
  reports = await openBoard(page);
  await ready(page, "Landing");
});

/** Waits for the expected reports, then checks nothing more arrives (exactly once). */
async function expectReports(page: Page, expected: Report[]) {
  await expect.poll(() => reports.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(expected.length);
  await page.waitForTimeout(600);
  expect(reports).toEqual(expected);
}

const LANDING = SCREEN_ID.Landing;
const board = (page: Page) => page.locator(".board");

async function activate(page: Page) {
  const p = await pagePoint(page, "Landing", 640, 795);
  await page.mouse.click(p.x, p.y);
  await expect(layers(page)).toContainText("Top nav");
}

test("GET /screens fails: the board shows the error with Retry; reported once; a failed retry is a new report", async ({ page }) => {
  await devMenu(page, async () => {
    await devCheckbox(page, /GET \/screens fails/).check();
    await page.getByRole("button", { name: "Reload board" }).click();
  });
  const alert = board(page).getByRole("alert");
  await expect(alert).toContainText("Couldn't load the board");
  await expectReports(page, [{ region: "board", screenId: null }]);

  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(alert).toContainText("Couldn't load the board");
  await expectReports(page, [
    { region: "board", screenId: null },
    { region: "board", screenId: null },
  ]);

  await devMenu(page, () => devCheckbox(page, /GET \/screens fails/).uncheck());
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".preview")).toHaveCount(24);
  // The panels kept working all along.
  await expect(layers(page)).toBeVisible();
});

test("an error thrown in a board timer gets the same board error and one report", async ({ page }) => {
  await devMenu(page, () => page.getByRole("button", { name: "Throw in a board timer" }).click());
  await expect(board(page).getByRole("alert")).toContainText("Couldn't load the board");
  await expectReports(page, [{ region: "board", screenId: null }]);
});

test("a preview whose script doesn't respond within 10s shows 'Couldn't connect' on that preview only", async ({ page }) => {
  test.setTimeout(45_000);
  await ready(page, "Sign up");
  await activate(page);
  await devMenu(page, () => devCheckbox(page, /Bridge stays silent/).check());
  await expect(preview(page, "Landing").getByRole("alert")).toContainText("Couldn't connect to this preview", { timeout: 15_000 });
  await expect(page.locator(".preview [role=alert]")).toHaveCount(1);
  await expectReports(page, [{ region: "preview", screenId: LANDING }]);

  // Everything else keeps working.
  await clickEl(page, "Sign up", "h1");
  await expect(selectedLabels(page)).toHaveText("h1");

  // Landing is no longer active (it can't be clicked), but the menu still lists it.
  await devMenu(page, () => devCheckbox(page, /Landing: bridge silent/).click() /* the row goes away once unticked */);
  await preview(page, "Landing").getByRole("button", { name: "Retry" }).click();
  await expect(preview(page, "Landing").locator(".preview-frame")).toBeVisible();
  await ready(page, "Landing");
  await page.waitForTimeout(500);
  await expect(preview(page, "Landing").getByRole("alert")).toHaveCount(0);
});

test("an error while handling a message from a preview fails that preview only", async ({ page }) => {
  await activate(page);
  await devMenu(page, () => page.getByRole("button", { name: "Throw while handling its next message" }).click());
  await expect(preview(page, "Landing").getByRole("alert")).toContainText("This preview hit an error");
  await expectReports(page, [{ region: "preview", screenId: LANDING }]);
  await preview(page, "Landing").getByRole("button", { name: "Retry" }).click();
  await ready(page, "Landing");
});

test("a row that doesn't load in 3s shows 'Couldn't load' with Retry on that row only", async ({ page }) => {
  await activate(page);
  await devMenu(page, () => devCheckbox(page, /Row child loads hang/).check());
  await row(page, "Top nav").locator(".chevron").click();
  await expect(row(page, "Top nav")).toContainText("Loading…");
  await expect(row(page, "Top nav")).toContainText("Couldn't load", { timeout: 5_000 });
  await expect(layers(page).locator(".row-status.error")).toHaveCount(1);
  await expectReports(page, [{ region: "layers-row", screenId: LANDING }]);

  // Other rows still work, and a retry that fails again is a new report.
  await row(page, "section#hero").click();
  await expect(selectedLabels(page)).toHaveText("section#hero");
  await row(page, "Top nav").getByRole("button", { name: "Retry" }).click();
  await expect(row(page, "Top nav")).toContainText("Couldn't load", { timeout: 5_000 });
  await expect.poll(() => reports.length).toBe(2);

  await devMenu(page, () => devCheckbox(page, /Row child loads hang/).uncheck());
  await row(page, "Top nav").getByRole("button", { name: "Retry" }).click();
  await expect(row(page, "span.logo")).toBeVisible();
});

test("collapsing a row while it loads is not a failure", async ({ page }) => {
  await activate(page);
  await devMenu(page, () => devCheckbox(page, /Row child loads hang/).check());
  await row(page, "Top nav").locator(".chevron").click();
  await row(page, "Top nav").locator(".chevron").click(); // collapse: cancelled
  await page.waitForTimeout(3500);
  await expect(layers(page).locator(".row-status")).toHaveCount(0);
  expect(reports).toEqual([]);
});

test("the top level not loading fails the layers panel only", async ({ page }) => {
  await activate(page);
  await devMenu(page, async () => {
    await devCheckbox(page, /Top-level load hangs/).check();
    await page.getByRole("button", { name: "Reload layers" }).click();
  });
  await expect(layers(page).getByRole("alert")).toContainText("Couldn't load layers", { timeout: 5_000 });
  await expectReports(page, [{ region: "layers", screenId: LANDING }]);
  await clickEl(page, "Landing", "#hero h1"); // the board and inspector still work
  await expect(field(page, "Name")).toHaveText("h1");
});

test("GET /elements fails: error in Details only, Live still shows, reported once with the key", async ({ page }) => {
  await devMenu(page, () => devCheckbox(page, /GET \/elements fails/).check());
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(inspector(page).getByRole("alert")).toContainText("Couldn't load details");
  await expect(field(page, "Name")).toHaveText("Get started");
  await expectReports(page, [{ region: "details", screenId: LANDING, elementKey: "cta-primary" }]);

  await devMenu(page, () => devCheckbox(page, /GET \/elements fails/).uncheck());
  await inspector(page).getByRole("button", { name: "Retry" }).click();
  await expect(field(page, "Component")).toHaveText("Button");
});

test("a render error in the inspector shows in the inspector; board and layers keep working", async ({ page }) => {
  await clickEl(page, "Landing", "#hero h1");
  await devMenu(page, () => devCheckbox(page, /Inspector throws on render/).check());
  await expect(inspector(page).getByRole("alert")).toContainText("The inspector hit an error");
  await expectReports(page, [{ region: "inspector", screenId: LANDING }]);
  await row(page, "Top nav").click();
  await expect(selectedLabels(page)).toHaveText("Top nav");
  await devMenu(page, () => devCheckbox(page, /Inspector throws on render/).uncheck());
  await inspector(page).getByRole("button", { name: "Retry" }).click();
  await expect(field(page, "Name")).toHaveText("Top nav");
});

test("a response that arrives after its region is gone changes nothing and reports nothing", async ({ page }) => {
  await devMenu(page, async () => {
    await page.locator(".dev-menu").getByRole("spinbutton").fill("1500");
    await devCheckbox(page, /GET \/elements fails/).check();
  });
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(inspector(page)).toContainText("Loading details…");
  await page.keyboard.press("Escape"); // the Details region goes away
  await page.waitForTimeout(2500);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(reports).toEqual([]);
});

test("errors inside a page show a 'Page error' badge with the message on hover", async ({ page }) => {
  await ready(page, "Docs");
  // Page 6 rejects a promise after 4s.
  const badge = preview(page, "Docs").locator(".page-error");
  await expect(badge).toBeVisible({ timeout: 8_000 });
  await badge.hover();
  await expect(badge.locator(".page-error-tip")).toBeVisible();
  await expect(badge.locator(".page-error-tip")).toContainText("Failed to load analytics");

  // Page 1's "Watch demo" throws when clicked in Interact mode.
  await page.keyboard.press("i");
  await clickEl(page, "Landing", "#crash");
  await expect(preview(page, "Landing").locator(".page-error")).toBeVisible();
  await expect(preview(page, "Landing").locator(".page-error-tip")).toContainText(/null/);
  expect(reports).toEqual([]); // the page's own errors are not app failures
});

