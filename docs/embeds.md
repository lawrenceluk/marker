# Embeds

An embed is a small interactive figure written by an agent: one HTML file with
inline CSS and JavaScript, shown inside a note like an image.

```markdown
![p95 latency by region](marker-embed:Q2x1ZXMgYXJlIG9wYXF1ZQ "h=420 poster=marker-asset:UG9zdGVyIGlkIGhlcmUhIQ")
```

**Use an embed only when interaction adds information** (hover values, toggled
series, a slider driving a model, a sortable table). Otherwise upload a PNG
([docs/images.md](images.md)). Embeds are read-only figures: no forms, logins,
backends or games.

Embeds need the same R2 storage as images. Without it the API answers 503 and
`marker-embed:` references render as their caption only.

## Adding an embed (agents)

The note must exist first. Reserving never changes the note's `rev`.

### One call (≤ 512 KiB)

```bash
curl -X POST https://marker.luk.xyz/api/assets \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"KEY\",\"content_type\":\"text/html\",\"data_base64\":\"$(base64 < chart.html | tr -d '\n')\"}"
# → { "asset_id": "…", "markdown": "![](marker-embed:…)", "type": "text/html",
#     "size": 4210, "uploaded": true, "url": "https://…", "url_expires_at": … }
```

With `data_base64` the server also checks the file: it must be UTF-8 and must
not use `<meta http-equiv="refresh">` (400 otherwise).

### Reserve, then PUT

```bash
SIZE=$(wc -c < chart.html)
curl -X POST https://marker.luk.xyz/api/assets \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"KEY\",\"content_type\":\"text/html\",\"size\":$SIZE}"
# → { "asset_id", "markdown", "uploaded": false, "upload_url",
#     "upload_headers": { "Content-Type": "text/plain; charset=utf-8", "Content-Length": "…" } }

curl -X PUT -H "Content-Type: text/plain; charset=utf-8" --data-binary @chart.html "UPLOAD_URL"
```

The file is stored as `text/plain` on purpose, so the PUT must send exactly
that `Content-Type` (and the reserved length) or storage answers 403.

### Then reference it

```markdown
![Caption shown under the figure](marker-embed:ASSET_ID "h=420")
```

Parameters go in the title slot, separated by spaces:

| Parameter | Meaning |
| --- | --- |
| `h=420` | height in px for the first paint (120–2000). The embed then sizes itself. |
| `ratio=16:9` | first-paint height from the column width instead of `h` |
| `poster=marker-asset:<id>` | a PNG shown before the embed starts, if it stalls, when printing, and without JavaScript. Upload it like any image. |

A poster is recommended, not required. The alt text is the caption; leave it
empty for no caption.

Embeds follow the same lifecycle as images: removing the last
`marker-embed:<id>` reference deletes the file about 24 hours later, and a
poster is kept while some `poster=marker-asset:<id>` references it.

## The environment

Your file runs in a sandboxed frame on a separate storage domain, under this
policy:

- **No network.** `fetch`, XHR, WebSocket, EventSource, workers, nested frames
  and `https:` images are all blocked. **Inline your data** as JSON in the
  file. Images must be `data:` or `blob:` URLs.
- **Scripts only from jsDelivr's npm path, at exact versions:**
  `https://cdn.jsdelivr.net/npm/<package>@<exact-version>/<file>`. No ranges,
  no `latest`. Add `integrity` and `crossorigin="anonymous"` (jsDelivr's "Copy
  HTML + SRI"). For ES modules use the pinned `/+esm` URL, for example
  `import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm"` (SRI isn't
  stable for `+esm`). unpkg, esm.run, `/gh/` and `/combine/` are blocked.
- Stylesheets may also come from jsDelivr `/npm/` or Google Fonts.
- No forms, popups, `alert`/`confirm`, downloads, cookies or storage
  (`localStorage` throws).
- **Your embed starts automatically when it scrolls into view**, for every
  reader. Keep startup cheap. It's stopped after 30 seconds off-screen or when
  the tab is hidden, and restarted on return, so don't rely on long-lived
  state. If the page stops hearing from it for 5 seconds (a long synchronous
  loop counts), it's replaced by its poster with a reload button.
- Honour `marker.reducedMotion`: when true, don't animate.
- Links: call `marker.openLink("https://…")`. Marker asks the reader to
  confirm before opening it in a new tab. Plain `<a target=_blank>` does
  nothing.
- Errors, uncaught exceptions and blocked requests are logged to the reader's
  console as `[marker] embed error: …`.

### The `marker` object

| Member | |
| --- | --- |
| `marker.mode` | `"light"` or `"dark"` |
| `marker.theme` | the theme variables below, as an object |
| `marker.reducedMotion` | the reader prefers reduced motion or saves data |
| `marker.width` | column width in px when the embed started |
| `marker.visible` | false while scrolled away (pause animation) |
| `marker.openLink(url)` | https only, behind a confirm |
| `marker.on("theme", fn)` | the reader's colour scheme changed; the variables are already updated |
| `marker.on("visibility", fn)` | `fn({ visible })` |

## Theming

Marker sets these CSS variables on your document's `:root`, plus
`color-scheme`, a paper background and a 16px Geist body with no margin. An
embed that styles nothing still looks native.

| Variable | Use |
| --- | --- |
| `--paper` | background |
| `--ink-text` | text, axes, marks |
| `--muted` | secondary text, gridline labels |
| `--rule` | hairlines, gridlines |
| `--accent-ink` | one highlighted series or interactive affordance |
| `--code-paper`, `--code-ink` | code blocks |
| `--font-sans`, `--font-mono` | Geist and Geist Mono (from jsDelivr), with system fallbacks |
| `--text-xs` … `--text-2xl` | 12, 14, 16, 20, 24, 32 px |
| `--space-1` … `--space-6` | 4, 8, 12, 16, 24, 32 px |
| `--red-new` | **don't use.** Red means "new to you" in Marker. |

Design rules: no title, heading or explanatory label inside the embed (the
caption and the note do that). Axis labels, legends and values are content
and are fine.

Reading the variables in JavaScript (d3, Chart.js, Vega):

```js
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ink = css("--ink-text"), rule = css("--rule"), accent = css("--accent-ink");
Chart.defaults.color = ink;              // Chart.js
Chart.defaults.borderColor = rule;
Chart.defaults.font.family = css("--font-sans");
marker.on("theme", () => location.reload()); // or redraw with fresh colours
```

## Height

Automatic. The embed reports its document height whenever it changes and Marker
resizes the frame (120–2000 px; on phones at most 1.5 screen heights). Set `h`
so the first paint doesn't jump. Avoid `height: 100vh` on `body`.

## Complete example (d3)

```html
<!doctype html>
<html lang="en">
<head>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"
  integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i" crossorigin="anonymous"></script>
<style>
  svg { display: block; width: 100%; height: auto; font: var(--text-xs) var(--font-sans); }
  .tip { position: absolute; padding: var(--space-1) var(--space-2); background: var(--paper); border: 1px solid var(--rule); pointer-events: none; }
</style>
</head>
<body>
<div id="chart"></div><div class="tip" hidden></div>
<script>
const data = [{ region: "us-east", p95: 41 }, { region: "eu-west", p95: 58 }, { region: "ap-south", p95: 93 }, { region: "sa-east", p95: 77 }];
function draw() {
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const w = 640, h = 320, m = { t: 16, r: 16, b: 32, l: 40 };
  const x = d3.scaleBand(data.map(d => d.region), [m.l, w - m.r]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.p95)]).nice().range([h - m.b, m.t]);
  const svg = d3.select("#chart").html("").append("svg").attr("viewBox", [0, 0, w, h]);
  svg.append("g").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x)).attr("color", css("--muted"));
  svg.append("g").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d} ms`)).attr("color", css("--muted"));
  const tip = d3.select(".tip");
  svg.selectAll("rect").data(data).join("rect")
    .attr("x", d => x(d.region)).attr("width", x.bandwidth()).attr("fill", css("--ink-text"))
    .attr("y", h - m.b).attr("height", 0)
    .on("pointerenter", function (e, d) { d3.select(this).attr("fill", css("--accent-ink")); tip.attr("hidden", null).text(`${d.region}: ${d.p95} ms`); })
    .on("pointermove", e => tip.style("left", `${e.pageX + 12}px`).style("top", `${e.pageY - 28}px`))
    .on("pointerleave", function () { d3.select(this).attr("fill", css("--ink-text")); tip.attr("hidden", true); })
    .transition().duration(marker.reducedMotion ? 0 : 400)
    .attr("y", d => y(d.p95)).attr("height", d => y(0) - y(d.p95));
}
draw();
marker.on("theme", draw);
</script>
</body>
</html>
```

Reference it with `![p95 latency by region](marker-embed:<id> "h=340")`.

## Limits

| Limit | Value | Error |
| --- | --- | --- |
| Type | `text/html`, one self-contained file | 415 |
| Per embed | 512 KiB (either upload path) | 413 |
| Per note | 10 embeds | 409 |
| Per note | 100 images and embeds, 50 MiB total (shared with images) | 409 / 413 |
| Reservations | 60 per hour per note (shared with images) | 429 with `Retry-After` |

## Privacy and safety

- The file is the only thing inside the frame: no cookies, no note text, no
  key, no reader data. The frame has an opaque origin, so it can't read
  Marker's page or storage.
- Anyone with the note key can add, read and delete its embeds.
- A view link opened directly shows the file as plain text. The shell link
  refuses to run outside a frame, but a third-party page that frames it could
  run the embed unsandboxed on the storage domain until the link expires
  (at most two hours). It still has no Marker cookies or data. A Worker on a
  dedicated domain with real `sandbox` headers closes this (planned for v2).
- Link previews, Open Graph images and folder listings never run or describe
  embeds.

## Operations

### How it works

- The file is stored at `<asset_ns>/<id>` as `text/plain; charset=utf-8`, in
  the same per-note index as images (`t: "html"`), and swept the same way.
- The iframe never loads that file. It loads a **shell** document at the bucket
  root, named `embed-shell-<hash>.html` where `<hash>` is the first 16 hex
  digits of SHA-256 of the shell HTML (so each build uploads a new object
  automatically), as
  `<shell view URL>#src=<file view URL>`, with
  `sandbox="allow-scripts"`, `credentialless`, `referrerpolicy="no-referrer"`
  and `allow=""`. The shell holds a meta CSP whose only network permission is
  `connect-src` to the storage origin, fetches the file, and writes it into
  itself behind the embed CSP (`connect-src 'none'`), the theme defaults and
  the bridge. Policies only intersect, so the file never has network access.
- The parent and the shell talk over one `MessageChannel`. Parent → embed:
  `init` (theme, mode, width, reducedMotion, lang), `theme`, `visibility`.
  Embed → parent: `heartbeat` (every second), `ready`, `resize`, `openLink`,
  `error`. Every message is schema-checked; more than 50 a second or over
  8 KB is dropped.
- Marker's own CSP is enforced and allows framing only its own origin and the
  storage origin (`frame-src`).

### Setup

1. Images must already work (R2 variables and bucket; see
   [docs/images.md](images.md#r2-bucket-setup)).
2. Add a CORS rule so the sandboxed shell (origin `null`) can read files:

   ```json
   { "AllowedOrigins": ["*"], "AllowedMethods": ["GET"], "MaxAgeSeconds": 3600 }
   ```

   View URLs are presigned, so this only lets a page read a file whose
   signed link it already has.
3. Nothing else is required: the first embed reserve, or opening a note that
   already has embeds, uploads the current shell if the bucket lacks that hash.
   Optional: `npm run embeds:shell` with the deployment's `R2_*` variables
   pre-uploads it (`-- --print` writes the HTML to stdout).
4. Optional: `EMBED_PARENT_ORIGINS` (comma-separated, `https://*.example`
   wildcards allowed) lists the pages the shell agrees to run in. Default:
   `https://marker.luk.xyz,https://*.vercel.app`. Changing it changes the
   shell hash, so the next embed use uploads the new object automatically.
