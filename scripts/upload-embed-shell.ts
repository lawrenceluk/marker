/**
 * Uploads (or replaces) `embed-shell-v1.html` in the configured R2 bucket.
 * Run once per bucket with the deployment's R2_* variables, and again after
 * changing EMBED_PARENT_ORIGINS. `--print` writes the document to stdout instead.
 *
 *   npm run embeds:shell
 *   npm run embeds:shell -- --print
 */
import { r2Config } from "../app/lib/r2";
import { EMBED_SHELL_KEY, embedParentOrigins, shellHtmlFor, uploadEmbedShell } from "../app/lib/embeds";

const config = r2Config();
if (!config) {
  console.error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first.");
  process.exit(1);
}

if (process.argv.includes("--print")) {
  process.stdout.write(shellHtmlFor(config));
} else {
  await uploadEmbedShell(config);
  console.log(`Uploaded ${EMBED_SHELL_KEY} to ${config.bucket} (parents: ${embedParentOrigins().join(", ")}).`);
}
