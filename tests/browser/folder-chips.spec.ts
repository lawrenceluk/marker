import { expect, test, type Locator, type Page } from "@playwright/test";

async function openFolder(page: Page, request: import("@playwright/test").APIRequestContext, project: string) {
  const stamp = `${project}-${Date.now()}`;
  const creatorId = `chips_creator_${stamp}`.replace(/[^A-Za-z0-9_~-]/g, "-").padEnd(24, "x");
  const notes: [string, string[]][] = [["Alpha beta", ["alpha", "beta"]], ["Beta gamma", ["beta", "gamma"]], ["Alpha gamma", ["alpha", "gamma"]]];
  for (const [title, tags] of notes)
    await request.post("/api/content", { data: { key: `chips-${title.replace(" ", "-")}-${stamp}`, content: `# ${title}`, creator_id: creatorId, creator_name: "Chips", tags } });
  await page.goto(`/c?token=${creatorId}`);
  await expect(page.getByRole("heading", { name: "Chips" })).toBeVisible();
}

const chip = (page: Page, tag: string) => page.getByRole("group", { name: "Filter by tags" }).getByRole("button", { name: new RegExp(`^${tag} \\d+$`) });

async function tap(locator: Locator, touch: boolean) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function doubleTap(locator: Locator, touch: boolean) {
  if (!touch) return locator.dblclick();
  await locator.tap();
  await locator.tap();
}

async function expectPressed(page: Page, on: string[]) {
  for (const tag of ["alpha", "beta", "gamma"])
    await expect(chip(page, tag)).toHaveAttribute("aria-pressed", String(on.includes(tag)));
}

test("folder nav: Home icon on the left, Forget inside the overflow menu", async ({ page, request }, info) => {
  await openFolder(page, request, info.project.name);
  const nav = page.getByRole("navigation", { name: "Folder actions" });
  const homeLink = nav.getByRole("link", { name: "Home" });
  await expect(homeLink).toHaveAttribute("href", "/");
  await expect(nav.locator(":scope > *").first()).toHaveAttribute("aria-label", "Home");
  await expect(page.getByText("← Marker")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forget this folder" })).toHaveCount(0);

  await nav.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("button", { name: "Forget this folder" })).toBeVisible();
  await page.screenshot({ path: `test-results/folder-menu-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Forget this folder" })).toHaveCount(0);

  await homeLink.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();
});

test("tag chips: tap toggles AND filters, double-tap and long-press select only that tag", async ({ page, request }, info) => {
  const touch = info.project.use.hasTouch === true;
  await openFolder(page, request, info.project.name);

  await tap(chip(page, "alpha"), touch);
  await expect(page).toHaveURL(/\/c\?tag=alpha$/);
  await tap(chip(page, "beta"), touch);
  await expect(page).toHaveURL(/\/c\?tag=alpha&tag=beta$/);
  await expect(page.getByText("1 note tagged alpha + beta")).toBeVisible();
  await expectPressed(page, ["alpha", "beta"]);

  // Double-tapping an unselected chip leaves only it selected.
  await doubleTap(chip(page, "gamma"), touch);
  await expect(page).toHaveURL(/\/c\?tag=gamma$/);
  await expectPressed(page, ["gamma"]);

  // Double-tapping an already selected chip must not leave it toggled off.
  await tap(chip(page, "alpha"), touch);
  await expect(page).toHaveURL(/\/c\?tag=alpha&tag=gamma$/);
  await doubleTap(chip(page, "alpha"), touch);
  await expect(page).toHaveURL(/\/c\?tag=alpha$/);
  await expectPressed(page, ["alpha"]);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/c\?tag=alpha$/);

  // Long-press selects only that tag and swallows the click that follows the release.
  const beta = chip(page, "beta");
  await tap(chip(page, "gamma"), touch);
  await expect(page).toHaveURL(/\/c\?tag=alpha&tag=gamma$/);
  if (touch) {
    const box = (await beta.boundingBox())!;
    const point = { pointerType: "touch", isPrimary: true, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await beta.dispatchEvent("pointerdown", point);
    await page.waitForTimeout(700);
    expect(await beta.evaluate(el => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(false);
    await beta.dispatchEvent("pointerup", point);
    await beta.dispatchEvent("click", { detail: 1 });
  } else {
    const box = (await beta.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
  }
  await expect(page).toHaveURL(/\/c\?tag=beta$/);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/c\?tag=beta$/);
  await expectPressed(page, ["beta"]);
  await expect(page.getByText("2 notes tagged beta")).toBeVisible();

  // No callout, text selection or double-tap zoom on chips.
  const style = await beta.evaluate(el => {
    const s = getComputedStyle(el) as CSSStyleDeclaration & { webkitTouchCallout?: string; webkitUserSelect?: string };
    return { select: s.userSelect || s.webkitUserSelect, touchAction: s.touchAction, callout: s.webkitTouchCallout ?? "none" };
  });
  expect(style).toEqual({ select: "none", touchAction: "manipulation", callout: "none" });
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  await page.screenshot({ path: `test-results/folder-chips-${info.project.name}.png`, fullPage: true });
});
