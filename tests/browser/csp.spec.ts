import { expect, test } from "@playwright/test";

test("Home, a note, the editor and the folder page load under the enforced CSP without violations", async ({ page, request }, info) => {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const seen: string[] = JSON.parse(sessionStorage.getItem("violations") ?? "[]");
    document.addEventListener("securitypolicyviolation", event => {
      seen.push(`${location.pathname} ${event.violatedDirective} ${event.blockedURI}`);
      sessionStorage.setItem("violations", JSON.stringify(seen));
    });
  });
  const key = `csp-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content: "# CSP\n\n- [ ] A checkbox\n\n```ts\nconst x = 1;\n```\n\n> Quote with *emphasis*" } });

  const home = await page.goto("/");
  expect(home!.headers()["content-security-policy"]).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Marker", exact: true })).toBeVisible();

  await page.goto(`/?key=${key}&persist=1`);
  await expect(page.getByRole("heading", { name: "CSP" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note content" })).toBeVisible();

  await page.goto("/c");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => sessionStorage.getItem("violations") ?? "[]")).toBe("[]");
});
