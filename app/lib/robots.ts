/** Shared anti-indexing header. Meta noindex lives in the root layout too. */
export const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet";

/**
 * Link-preview fetchers that need to GET persist URLs despite
 * `User-agent: * / Disallow: /`. Search and training crawlers are not here.
 *
 * robots.txt is advisory. iMessage often fetches from the sender's device
 * with a UA that already includes facebookexternalhit / Twitterbot.
 */
export const PREVIEW_BOT_USER_AGENTS = [
  "Twitterbot",
  "facebookexternalhit",
  "Facebot",
  "Slackbot",
  "Slackbot-LinkExpanding",
  "Discordbot",
  "TelegramBot",
  "WhatsApp",
  "LinkedInBot",
  "SkypeUriPreview",
  "Iframely",
  "Embedly",
  "Redditbot",
  "Pinterest",
  "vkShare",
  "Mattermost",
] as const;

export function applyNoIndexHeaders(headers: Headers) {
  headers.set("X-Robots-Tag", ROBOTS_TAG);
  headers.set("Cache-Control", "no-store, private");
}
