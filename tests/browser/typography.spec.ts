import { expect, test } from "@playwright/test";

const SCALE = ["10px", "12px", "14px", "16px", "20px", "24px", "32px"];

const content = `# Title

Body with *emphasis*, \`inline code\` and a long link [https://example.com/a/really/long/path/that/keeps/going/and/going?with=query](https://example.com/a).

#### Four

##### Five

###### Six

> Quoted text with \`code\`.

\`\`\`ts
const answer = 42;
\`\`\`
`;

const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`note typography stays on the type scale in ${colorScheme}`, async ({ page, request }, info) => {
    await page.emulateMedia({ colorScheme });
    const key = `typography-${colorScheme}-${info.project.name}-${Date.now()}`;
    await request.post("/api/content", { data: { key, content } });
    await page.goto(`/?key=${key}&persist=1`);
    await expect(page.getByRole("heading", { name: "Six" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const styles = await page.evaluate(() => {
      const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      const pick = (selector: string) => {
        const s = css(selector);
        return { size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, family: s.fontFamily, color: s.color, background: s.backgroundColor };
      };
      const sizes = [...document.querySelectorAll("body *")]
        .filter(element => element.getClientRects().length > 0 && element.textContent?.trim())
        .map(element => getComputedStyle(element).fontSize);
      return {
        sizes: [...new Set(sizes)],
        h4: pick(".prose h4"), h5: pick(".prose h5"), h6: pick(".prose h6"), p: pick(".prose p"),
        inlineCode: pick(".prose p code"), pre: pick(".prose pre"), preCode: pick(".prose pre code"),
        link: { ...pick(".prose p a"), overflowWrap: css(".prose p a").overflowWrap, wordBreak: css(".prose p a").wordBreak },
        quote: pick(".prose blockquote"),
        quoteCodeStyle: css(".prose blockquote code").fontStyle,
        realItalic: [...document.fonts].some(face => face.style === "italic" && face.status === "loaded"),
      };
    });

    expect(styles.sizes.filter(size => !SCALE.includes(size))).toEqual([]);
    expect([styles.h4.size, styles.h5.size, styles.h6.size]).toEqual(["16px", "14px", "14px"]);
    expect([styles.h4.weight, styles.h5.weight, styles.h6.weight]).toEqual(["600", "600", "600"]);
    expect(styles.h6.color).not.toBe(styles.h5.color);
    for (const code of [styles.inlineCode, styles.preCode]) expect(code.family).toMatch(/^"?Geist Mono/);
    expect(luminance(styles.pre.background) > luminance(styles.pre.color)).toBe(colorScheme === "light");
    expect(styles.link.lineHeight).toBe(styles.p.lineHeight);
    expect([styles.link.overflowWrap, styles.link.wordBreak]).toEqual(["anywhere", "normal"]);
    expect(styles.quote.family).not.toBe(styles.p.family);
    expect(styles.realItalic).toBe(true);
    expect(styles.quoteCodeStyle).toBe("normal");
  });
}

test("OG image renders with Geist", async ({ request }, info) => {
  const key = `typography-og-${info.project.name}-${Date.now()}`;
  await request.post("/api/content", { data: { key, content } });
  const response = await request.get(`/og?key=${key}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});
