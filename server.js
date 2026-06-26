// server.js — serve static site + browser-like proxy
// Node 18+ required (built-in fetch)
// Place your site files (index.html, style.css, app.js, libs/…) in ./public

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

// 1) Static website (./public)
app.use(cors());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

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

// 2) Proxy: http://localhost:3000/img?url=...
// Used for both images and DeckLog HTML/API fetches to avoid CORS and keep remote sites seeing a normal browser-like request.
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");

  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: buildProxyHeaders(url),
    });

    if (!r.ok) return res.status(r.status).send(`Upstream error ${r.status}`);

    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=3600");

    if (r.body && typeof r.body.pipe === "function") {
      r.body.pipe(res);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    }
  } catch (e) {
    console.error("Proxy error", e);
    res.status(500).send(`Proxy error: ${e.message}`);
  }
});

// 3) Friendly root message (optional)
app.get("/", (req, res) => {
  res.send('✅ Server running. Open <a href="/index.html">/index.html</a> or use /img?url=...');
});

app.listen(PORT, () => {
  console.log(`🚀 Serving ./public and proxy on http://localhost:${PORT}`);
});
