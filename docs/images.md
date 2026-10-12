# Images

Marker notes can show PNG, JPEG, GIF and WebP images. The bytes live in a
private Cloudflare R2 bucket and the browser receives only short-lived
presigned URLs. Markdown refers to an image by an opaque id:

```markdown
![Sketch of the flow](marker-asset:Q2x1ZXMgYXJlIG9wYXF1ZQ)
```

Images are optional per deployment. Without the R2 environment variables the
images API answers 503, the editor hides "Insert image", and any
`marker-asset:` image renders as an "Image unavailable" placeholder. Notes
otherwise work exactly as before.

## Adding an image (agents)

The note must already exist; reserve against a missing note returns 404.
Reserving never changes the note's `rev`, so it can't cause a 409 on your next
write.

### Small images (≤ 1 MiB): one call

```bash
curl -X POST https://marker.luk.xyz/api/assets \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"KEY\",\"content_type\":\"image/png\",\"data_base64\":\"$(base64 < chart.png | tr -d '\n')\"}"
# → { "asset_id": "…", "markdown": "![](marker-asset:…)", "type": "image/png",
#     "size": 48213, "uploaded": true, "url": "https://…", "url_expires_at": 1760000000000 }
```

### Larger images (≤ 5 MiB): reserve, then PUT

```bash
SIZE=$(wc -c < photo.jpg)
curl -X POST https://marker.luk.xyz/api/assets \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"KEY\",\"content_type\":\"image/jpeg\",\"size\":$SIZE}"
# → { "asset_id", "markdown", "uploaded": false, "upload_url",
#     "upload_headers": { "Content-Type": "image/jpeg", "Content-Length": "…" },
#     "expires_in": 600, "url", "url_expires_at" }

curl -X PUT -H "Content-Type: image/jpeg" --data-binary @photo.jpg "UPLOAD_URL"
```

The upload URL is valid for 10 minutes and is signed for exactly that
`Content-Type` and byte length; a different type or size gets 403 from storage.

### Then reference it

Write the note with the returned markdown, ideally with alt text:

```markdown
![Revenue by month, Q3](marker-asset:ASSET_ID)
```

Do not put `data:` URIs or base64 in markdown. They are not rendered and they
eat into the 1 MiB note limit.

### Listing a note's images

`GET /api/content` includes an `assets` array:

```json
{ "id": "…", "type": "image/png", "size": 48213, "created_at": 1760000000000,
  "markdown": "![](marker-asset:…)", "url": "https://…", "expires_at": 1760007200000,
  "delete_after": null }
```

`url` is a view link valid for at least an hour, or `null` when storage isn't
configured. `delete_after` is set when the image is scheduled for deletion
(see below). `GET /api/assets/urls?key=KEY` returns fresh view URLs only
(`{ "urls": { id: url }, "expires_at" }`); the viewer uses it when a page has
been open past expiry.

## Deletion follows the markdown

An image stays as long as the note's content references `marker-asset:<id>`.

- When a content write drops the last reference, the image gets a removal
  timestamp and is **permanently deleted about 24 hours later**
  (`delete_after`). Writing the reference back within that window cancels the
  deletion.
- An image that is reserved but never referenced is deleted the same way, 24
  hours after it was reserved. That also cleans up abandoned uploads, and
  images added in the editor and then cancelled.
- Deleting the note (`DELETE /api/content`) deletes its images right away.
  Notes that expire through `ttl` have their images removed by the daily
  sweep.
- Renaming the key keeps the images.

**Agents: when rewriting a note, keep every image reference you don't mean to
delete.** Dropping the line is how you delete an image.

## Limits

| Limit | Value | Error |
| --- | --- | --- |
| Types | PNG, JPEG, GIF, WebP | 415 |
| Per image | 5 MiB (1 MiB via `data_base64`) | 413 |
| Per note | 100 images | 409 |
| Per note | 50 MiB total | 413 |
| Reservations | 60 per hour per note | 429 with `Retry-After` |
| Whole deployment | uploads pause at 9.5 GB stored | 507 |

Other errors: 400 for invalid input, 404 for a missing note, 502 when a base64
upload to storage fails, 503 when images aren't configured.

## Privacy

- Images are stored and served byte-for-byte. **EXIF and other metadata,
  including GPS location, are kept.** Strip them before uploading if they're
  private.
- Anyone with the note key can see, add and delete its images. View URLs
  expire, but anyone holding one can open the image until it does.
- External `https://` images also render (`http://` is upgraded to https;
  other schemes are not loaded). They load from that host, which therefore
  learns viewers' IP addresses and when they read the note. Prefer uploading.
  Marker sends them with `referrerpolicy="no-referrer"`.
- Link previews (Open Graph descriptions) never include images.

## In the browser

The editor's "Insert image" button, paste and drag-and-drop all upload
directly to storage and insert `![file name](marker-asset:…)` at the caret.
Save is disabled until uploads finish. A brand-new note must be saved once
before it can take images. In the viewer, tapping an image opens it full screen.

## Operations

### How it works

Everything about a note's images lives on its Redis hash and is updated inside
the scripts that already run, so existing reads and writes cost the same
number of Redis commands as before. Reserving an image is one more script call.

| Key | Purpose |
| --- | --- |
| note hash `asset_ns` | random storage prefix for the note's objects (`<asset_ns>/<id>`) |
| note hash `assets` | JSON `{id: {t, s, c, r?}}`: type, bytes, created, removal mark |
| `assets:sweep` | ZSET of `<asset_ns>\|<note key>` scored by the next time the sweep needs to look |
| `assets:bytes` | total bytes reserved across the deployment |
| `assets:nsbytes` | HASH of bytes per `asset_ns`, so expired notes can still be accounted for |
| `assets:alerts` | HASH of `warn` / `stop` flags so each storage alert is sent once per crossing |

Each content write compares the `marker-asset:` ids in the new content with
the note's image list: newly unreferenced images get `r = now`, and
re-referenced ones lose it. The note's sweep entry is set to the earlier of
the next `r + 24h` and the note's expiry.

`GET /api/cron/assets-sweep` runs daily at 04:17 UTC (`vercel.json`) and needs
`Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends automatically.
It deletes images past their grace period and purges the prefix of deleted or
expired notes. Then it checks total storage.

### Storage alerts

When the total crosses 8 GB, the sweep emails `ALERT_EMAIL_TO` once. When
uploads hit the 9.5 GB stop, the failing upload triggers one email. Each alert
re-arms only after usage falls back below 7.5 GB (warn) or 9 GB (stop), so a
total that hovers around a threshold doesn't send one email per day. Without
`RESEND_API_KEY` and `ALERT_EMAIL_TO` the alert is logged instead, and nothing
fails.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | for images | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | for images | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | for images | R2 API token secret |
| `R2_BUCKET` | for images | e.g. `marker-assets` (production), `marker-assets-preview` (preview) |
| `CRON_SECRET` | for the sweep | any long random string; Vercel Cron sends it as a bearer token |
| `RESEND_API_KEY` | for alert email | otherwise alerts are only logged |
| `ALERT_EMAIL_TO` | for alert email | comma-separated recipients |
| `ALERT_EMAIL_FROM` | optional | defaults to `Marker <onboarding@resend.dev>` |
| `R2_ENDPOINT` | optional | overrides `https://<account>.r2.cloudflarestorage.com` (tests use a local mock) |

All four `R2_*` variables must be set for images to turn on.

### R2 bucket setup

1. Create private buckets `marker-assets` and `marker-assets-preview`. Don't
   enable public access or a custom domain.
2. Create an R2 API token with **Object Read & Write** access to those buckets
   only, and use its access key id and secret.
3. Add a CORS policy to each bucket so browsers can PUT uploads and GET images:

   ```json
   [
     {
       "AllowedOrigins": ["https://marker.luk.xyz"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   For the preview bucket, list the preview origins, or use `"*"`.
4. Optionally add a lifecycle rule to abort incomplete multipart uploads after 1
   day. Marker never uses multipart, so this is only a safety net.
