// server.js — serve static site + browser-like proxy
// Node 18+ required (built-in fetch)
// Place your site files (index.html, style.css, app.js, libs/…) in ./public

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;
const DECKLOG_ORIGIN = "https://decklog-en.bushiroad.com";

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
  } catch {}

  return headers;
}

function rewriteDeckLogText(text) {
  return String(text || "")
    .replace(/https:\/\/decklog-en\.bushiroad\.com/g, "")
    .replace(/https:\/\/decklog\.bushiroad\.com/g, "")
    .replace(/(src|href|action)=(["'])\/(?!\/)/gi, `$1=$2/`)
    .replace(/url\((['"]?)\/(?!\/)/gi, "url($1/");
}

async function proxyRemote(targetUrl, req, res, { rewrite = false } = {}) {
  try {
    const upstream = await fetch(targetUrl, {
      redirect: "follow",
      headers: buildProxyHeaders(targetUrl),
    });

    if (!upstream.ok) return res.status(upstream.status).send(`Upstream error ${upstream.status}`);

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=300");
    res.set("Access-Control-Allow-Origin", "*");

    const shouldRewrite = rewrite && /(text\/html|javascript|ecmascript|text\/css|application\/json)/i.test(ct);
    if (shouldRewrite) {
      const text = await upstream.text();
      return res.send(rewriteDeckLogText(text));
    }

    if (upstream.body && typeof upstream.body.pipe === "function") {
      upstream.body.pipe(res);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    }
  } catch (e) {
    console.error("Proxy error", targetUrl, e);
    res.status(500).send(`Proxy error: ${e.message}`);
  }
}

// 1) Static website (./public)
app.use(cors());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// 2) Generic proxy: http://localhost:3000/img?url=...
// Used for direct image downloads and raw DeckLog HTML/API fetches.
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  return proxyRemote(url, req, res, { rewrite: false });
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
    return proxyRemote(`${DECKLOG_ORIGIN}${req.originalUrl}`, req, res, { rewrite: true });
  });
});

// 5) Friendly root message (optional)
app.get("/", (req, res) => {
  res.send('✅ Server running. Open <a href="/index.html">/index.html</a> or use /img?url=...');
});

app.listen(PORT, () => {
  console.log(`🚀 Serving ./public and proxy on http://localhost:${PORT}`);
});
