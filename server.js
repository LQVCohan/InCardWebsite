// server.js — serve static site + browser-like proxy
// Node 18+ required (built-in fetch)
// Place your site files (index.html, style.css, app.js, libs/…) in ./public

const express = require("express");
const cors = require("cors");
const path = require("path");
const dns = require("dns");

// On some Windows/local networks, Node fetch may try IPv6 first and hang while Chrome works.
// Prefer IPv4 so DeckLog proxy requests fail fast or resolve like the browser.
dns.setDefaultResultOrder("ipv4first");

const app = express();
const PORT = 3000;
const DECKLOG_ORIGIN = "https://decklog-en.bushiroad.com";
const FETCH_TIMEOUT_MS = 15000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildProxyHeaders(targetUrl) {
  const headers = {
    "user-agent": BROWSER_UA,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9,vi;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
  };

  try {
    const target = new URL(targetUrl);
    headers.referer = `${target.origin}/`;
    headers.origin = target.origin;
  } catch {}

  return headers;
}

function rewriteDeckLogText(text) {
  return String(text || "")
    .replace(/https:\/\/decklog-en\.bushiroad\.com/g, "")
    .replace(/https:\/\/decklog\.bushiroad\.com/g, "")
    .replace(/(src|href|action)\s*=\s*(["'])\/(?!\/)/gi, `$1=$2/`)
    .replace(/url\((['"]?)\/(?!\/)/gi, "url($1/");
}

async function fetchWithTimeout(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(targetUrl, {
      redirect: "follow",
      headers: buildProxyHeaders(targetUrl),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sendProxyError(res, status, message, targetUrl) {
  res.status(status).type("text/plain").send([
    message,
    "",
    `Target: ${targetUrl}`,
    "Nếu lỗi này xuất hiện khi mở /view/<deckCode>, nghĩa là server local chưa lấy được DeckLog từ phía Node.",
  ].join("\n"));
}

async function proxyRemote(targetUrl, req, res, { rewrite = false } = {}) {
  try {
    const upstream = await fetchWithTimeout(targetUrl);

    if (!upstream.ok) {
      return sendProxyError(res, upstream.status, `Upstream error ${upstream.status}`, targetUrl);
    }

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=300");
    res.set("Access-Control-Allow-Origin", "*");

    const shouldRewrite = rewrite && /(text\/html|javascript|ecmascript|text\/css|application\/json)/i.test(ct);
    if (shouldRewrite) {
      const text = await upstream.text();
      return res.send(rewriteDeckLogText(text));
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.end(buf);
  } catch (e) {
    console.error("Proxy error", targetUrl, e);
    const status = e?.name === "AbortError" ? 504 : 500;
    const message = e?.name === "AbortError"
      ? `Proxy timeout sau ${FETCH_TIMEOUT_MS / 1000}s`
      : `Proxy error: ${e.message}`;
    return sendProxyError(res, status, message, targetUrl);
  }
}

function deckLogTargetFromLocalRequest(req) {
  return `${DECKLOG_ORIGIN}${req.originalUrl}`;
}

// 1) Static website (./public)
app.use(cors());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// 2) Generic proxy: http://localhost:3000/img?url=...
// If DeckLog itself requests /img/..., proxy that path to DeckLog instead of returning "Missing url".
app.use("/img", async (req, res, next) => {
  if (req.method !== "GET") return next();

  const url = req.query.url;
  if (url) return proxyRemote(url, req, res, { rewrite: false });

  return proxyRemote(deckLogTargetFromLocalRequest(req), req, res, { rewrite: true });
});

// 3) Optional prefixed DeckLog proxy.
app.use("/decklog-proxy", async (req, res) => {
  const pathAndQuery = req.originalUrl.replace(/^\/decklog-proxy/, "") || "/";
  return proxyRemote(`${DECKLOG_ORIGIN}${pathAndQuery}`, req, res, { rewrite: true });
});

// 4) DeckLog view/assets/API often use root-relative paths.
// These localhost routes let a hidden iframe render DeckLog as same-origin, so the frontend can read the rendered card grid.
[
  "/api",
  "/ajax",
  "/assets",
  "/build",
  "/card",
  "/cards",
  "/card_images",
  "/css",
  "/deck",
  "/deckview",
  "/fonts",
  "/images",
  "/js",
  "/packs",
  "/rails",
  "/recipe",
  "/storage",
  "/system",
  "/view",
].forEach((prefix) => {
  app.use(prefix, async (req, res, next) => {
    if (req.method !== "GET") return next();
    return proxyRemote(deckLogTargetFromLocalRequest(req), req, res, { rewrite: true });
  });
});

// 5) Friendly root message (optional)
app.get("/", (req, res) => {
  res.send('✅ Server running. Open <a href="/index.html">/index.html</a> or use /img?url=...');
});

// 6) Last-chance DeckLog proxy for root-relative assets that DeckLog loads from paths we do not know yet.
// Static files are served before this, so /index.html, /app.js, /style.css, /decklog.js still belong to InCard.
app.use(async (req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path === "/" || req.path === "/index.html") return next();
  return proxyRemote(deckLogTargetFromLocalRequest(req), req, res, { rewrite: true });
});

app.listen(PORT, () => {
  console.log(`🚀 Serving ./public and proxy on http://localhost:${PORT}`);
});
