import {
  EMBED_HEARTBEAT_MS,
  GEIST_MONO_URL,
  GEIST_SANS_URL,
  embedCsp,
} from "./embedPolicy";

/**
 * A content-addressed `embed-shell-<hash>.html` at the bucket root: the only
 * document an embed iframe ever loads. It is stored once per build (per
 * EMBED_PARENT_ORIGINS), immutable, and opened as
 * `<presigned shell URL>#src=<presigned raw URL>`. It fetches the agent's
 * file (stored as text/plain, so it never renders on its own) and writes it
 * into itself behind the embed CSP, the theme defaults and the bridge, so
 * agent code can't run before or without them.
 */

/** Safe inside an inline <script>: no `</script`, `<!--` or line separators survive. */
const js = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Runs first in the written document, before any agent markup is parsed. */
const BRIDGE = `(function () {
  "use strict";
  var m = window.__marker;
  try { delete window.__marker; } catch (e) { window.__marker = undefined; }
  if (!m) return;
  var port = m.port, init = m.init;
  var themeStyle = document.getElementById("marker-theme");
  var handlers = { theme: [], visibility: [] };
  function send(message) { try { port.postMessage(message); } catch (e) {} }
  function report(error) { send({ type: "error", message: String((error && error.message) || error).slice(0, 500) }); }
  function themeCss(theme, mode) {
    var out = [];
    for (var name in theme) {
      var value = theme[name];
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === "string" && !/[;{}<>]/.test(value)) out.push(name + ":" + value);
    }
    out.push("color-scheme:" + (mode === "dark" ? "dark" : "light"));
    return ":root{" + out.join(";") + "}";
  }
  function emit(name, detail) {
    handlers[name].forEach(function (fn) { try { fn(detail); } catch (e) { report(e); } });
  }
  var api = {
    v: 1,
    theme: init.theme || {},
    mode: init.mode === "dark" ? "dark" : "light",
    width: init.width,
    reducedMotion: !!init.reducedMotion,
    lang: init.lang,
    visible: true,
    openLink: function (url) { send({ type: "openLink", url: String(url) }); },
    on: function (name, fn) { if (handlers[name] && typeof fn === "function") handlers[name].push(fn); }
  };
  window.marker = api;
  themeStyle.textContent = themeCss(api.theme, api.mode);
  port.onmessage = function (event) {
    var d = event.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "theme" && d.theme && typeof d.theme === "object") {
      api.theme = d.theme;
      api.mode = d.mode === "dark" ? "dark" : "light";
      themeStyle.textContent = themeCss(api.theme, api.mode);
      emit("theme", { theme: api.theme, mode: api.mode });
    } else if (d.type === "visibility") {
      api.visible = !!d.visible;
      emit("visibility", { visible: api.visible });
    }
  };
  setInterval(function () { send({ type: "heartbeat" }); }, ${EMBED_HEARTBEAT_MS});
  send({ type: "heartbeat" });
  window.addEventListener("error", function (event) { report(event.message || event.error); });
  window.addEventListener("unhandledrejection", function (event) { report(event.reason); });
  document.addEventListener("securitypolicyviolation", function (event) {
    report("Blocked by the embed sandbox: " + event.effectiveDirective + " " + (event.blockedURI || ""));
  });
  var last = 0, queued = false;
  function measure() {
    queued = false;
    var body = document.body, root = document.documentElement;
    if (!body) return;
    var style = getComputedStyle(body), rootStyle = getComputedStyle(root);
    var height = Math.max(
      Math.max(body.scrollHeight, body.getBoundingClientRect().height) + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0),
      root.getBoundingClientRect().height + (parseFloat(rootStyle.marginTop) || 0) + (parseFloat(rootStyle.marginBottom) || 0)
    );
    // The root's scrollHeight never drops below the frame's own height, so it only counts when the document overflows.
    if (root.scrollHeight > root.clientHeight) height = Math.max(height, root.scrollHeight);
    height = Math.ceil(height);
    if (height !== last) { last = height; send({ type: "resize", height: height }); }
  }
  function schedule() { if (!queued) { queued = true; setTimeout(measure, 50); } }
  document.addEventListener("DOMContentLoaded", function () {
    if (window.ResizeObserver && document.body) new ResizeObserver(schedule).observe(document.body);
    schedule();
  });
  window.addEventListener("load", function () { schedule(); send({ type: "ready" }); });
})();`;

function childHead(): string {
  return [
    "<!doctype html>",
    `<meta http-equiv="Content-Security-Policy" content="${embedCsp()}">`,
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    '<meta name="referrer" content="no-referrer">',
    "<style>",
    `@font-face{font-family:"Geist";src:url(${GEIST_SANS_URL}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}`,
    `@font-face{font-family:"Geist Mono";src:url(${GEIST_MONO_URL}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}`,
    "html{background:var(--paper);color:var(--ink-text)}",
    "body{margin:0;font-family:var(--font-sans);font-size:16px;line-height:1.5}",
    "</style>",
    '<style id="marker-theme"></style>',
    "<script>",
  ].join("");
}

const BOOT = (storageOrigin: string, parentOrigins: string[]) => `(function () {
  "use strict";
  var STORAGE = ${js(storageOrigin)};
  var PARENTS = ${js(parentOrigins)};
  var HEAD = ${js(childHead())};
  var BRIDGE = ${js(BRIDGE)};
  function say(text) { document.body.textContent = text; }
  function allowed(origin) {
    for (var i = 0; i < PARENTS.length; i++) {
      var p = PARENTS[i], star = /^(https?:\\/\\/)\\*\\.(.+)$/.exec(p);
      if (p === origin) return true;
      if (star && origin.indexOf(star[1]) === 0 && origin.slice(-star[2].length - 1) === "." + star[2] && origin.slice(star[1].length).indexOf("/") < 0) return true;
    }
    return false;
  }
  if (window.top === window) return say("This embed only runs inside a Marker note.");
  if (self.origin !== "null") return say("This embed only runs in a sandboxed frame.");
  var ancestors = location.ancestorOrigins;
  if (ancestors) for (var i = 0; i < ancestors.length; i++) {
    if (ancestors[i] && ancestors[i] !== "null" && !allowed(ancestors[i])) return say("This embed only runs inside a Marker note.");
  }
  var src;
  try { src = new URL(new URLSearchParams(location.hash.slice(1)).get("src") || ""); } catch (e) {}
  if (!src || src.origin !== STORAGE) return say("Missing embed source.");
  var html = fetch(src.href, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" }).then(function (res) {
    if (!res.ok) throw new Error("storage answered " + res.status);
    return res.text();
  });
  html.catch(function () {});
  window.addEventListener("message", function onInit(event) {
    var d = event.data;
    if (event.source !== window.parent || !d || d.type !== "init" || d.v !== 1 || !event.ports || !event.ports[0]) return;
    window.removeEventListener("message", onInit);
    var port = event.ports[0];
    var beat = setInterval(function () { port.postMessage({ type: "heartbeat" }); }, ${EMBED_HEARTBEAT_MS});
    port.postMessage({ type: "heartbeat" });
    html.then(function (text) {
      clearInterval(beat);
      window.__marker = { port: port, init: d };
      document.open();
      document.write(HEAD + BRIDGE + "\\u003c/script>" + text);
      document.close();
    }, function (error) {
      clearInterval(beat);
      port.postMessage({ type: "error", message: "The embed could not be loaded: " + error.message });
    });
  });
})();`;

export function embedShellHtml({ storageOrigin, parentOrigins }: { storageOrigin: string; parentOrigins: string[] }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${embedCsp(storageOrigin)}">
<meta http-equiv="x-dns-prefetch-control" content="off">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Marker embed</title>
<style>html,body{margin:0;background:transparent;font:16px/1.5 system-ui,sans-serif}</style>
</head>
<body>
<script>${BOOT(storageOrigin, parentOrigins)}</script>
</body>
</html>
`;
}
