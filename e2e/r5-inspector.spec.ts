// R5: the inspector, with the real API.
import { expect, test } from "@playwright/test";
import { clickEl, devMenu, field, frameOf, inspector, openBoard, ready, type Report } from "./helpers";

let reports: Report[];

test.beforeEach(async ({ page }) => {
  reports = await openBoard(page);
  await ready(page, "Landing");
});

test("R5.1 Live values read from the page", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  const frame = await frameOf(page, "Landing");
  const expected = await frame.locator("[data-key=cta-primary]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      size: `${Math.round(r.width)} × ${Math.round(r.height)}`,
      position: `${Math.round(r.left + scrollX)}, ${Math.round(r.top + scrollY)}`,
      color: s.color,
      background: s.backgroundColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
    };
  });
  await expect(field(page, "Name")).toHaveText("Get started");
  await expect(field(page, "Tag")).toHaveText("button");
  await expect(field(page, "ID")).toHaveText("—");
  await expect(field(page, "Classes")).toHaveText("primary");
  await expect(field(page, "Size")).toHaveText(expected.size);
  await expect(field(page, "Position")).toHaveText(expected.position);
  await expect(field(page, "Text")).toHaveText("Get started");
  await expect(field(page, "Color")).toHaveText(expected.color);
  await expect(field(page, "Background")).toHaveText(expected.background);
  await expect(field(page, "Font family")).toHaveText(expected.fontFamily);
  await expect(field(page, "Font size")).toHaveText(expected.fontSize);
  await expect(field(page, "Font weight")).toHaveText(expected.fontWeight);
});

test("R5.1 Live values update when the element changes", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => {
    const el = document.querySelector("[data-key=cta-primary]") as HTMLElement;
    el.textContent = "Start now";
    el.style.width = "300px";
  });
  await expect(field(page, "Text")).toHaveText("Start now");
  await expect(field(page, "Size")).toHaveText(/^300 × /);
});

test("R5.1 the text is cut to 120 characters", async ({ page }) => {
  const frame = await frameOf(page, "Landing");
  await frame.evaluate(() => (document.querySelector("#hero p")!.textContent = "x".repeat(300)));
  await clickEl(page, "Landing", "#hero p");
  await expect(field(page, "Text")).toHaveText("x".repeat(120));
});

test("R5.1 Details come from GET /elements/:key", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(field(page, "Component")).toHaveText("Button");
  await expect(field(page, "Description")).toHaveText("Primary call to action on the landing hero.");
  await expect(field(page, "Status")).toHaveText("stable");
  await expect(field(page, "Owner")).toHaveText("Growth");
});

test("R5.1 no data-key: 'No details'; a 404: 'No details for this element' (not an error)", async ({ page }) => {
  await clickEl(page, "Landing", ".logo");
  await expect(inspector(page)).toContainText("No details");
  await clickEl(page, "Landing", "#crash"); // data-key="cta-crash" has no entry
  await expect(inspector(page)).toContainText("No details for this element");
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(reports).toEqual([]);
});

test("R5.2 several selected: 'N elements', shared values or 'Mixed', no Details", async ({ page }) => {
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await clickEl(page, "Landing", "#crash", { shift: true });
  await expect(inspector(page)).toContainText("2 elements");
  await expect(field(page, "Tag")).toHaveText("button");
  await expect(field(page, "Name")).toHaveText("Mixed");
  await expect(field(page, "Classes")).toHaveText("Mixed");
  await expect(inspector(page).getByRole("heading", { name: "Details" })).toHaveCount(0);
});

test("R5.3 when the selection changes while Details load, only the latest selection's details show", async ({ page }) => {
  await devMenu(page, async () => {
    await page.locator(".dev-menu").getByRole("spinbutton").fill("1500");
  });
  await clickEl(page, "Landing", "[data-key=cta-primary]");
  await expect(inspector(page)).toContainText("Loading details…");
  await clickEl(page, "Landing", "[data-key=feature-sync] h3");
  await expect(field(page, "Name")).toHaveText("h3"); // the click landed before the key
  await page.keyboard.press("Shift+Enter"); // up to the card, which has the data-key
  await expect(field(page, "Name")).toHaveText("article.feature");
  const seen = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const c = await field(page, "Component").textContent({ timeout: 100 }).catch(() => null);
    if (c) seen.add(c);
    await page.waitForTimeout(250);
  }
  expect([...seen]).toEqual(["FeatureCard"]);
  expect(reports).toEqual([]); // the replaced request is not a failure
});
