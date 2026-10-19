import type { Page } from "@playwright/test";

/** Match browser API calls whether or not persist tabs append `?key=`. */
export function apiPath(url: string, pathname: string): boolean {
  try {
    return new URL(url).pathname === pathname;
  } catch {
    return false;
  }
}

/** Trigger a revision poll the same way focus does in the app. */
export async function checkRevision(page: Page) {
  await page.waitForTimeout(50);
  await Promise.all([
    page.waitForResponse(response => apiPath(response.url(), "/api/revision")),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
}
