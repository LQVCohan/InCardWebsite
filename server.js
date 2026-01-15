// server.js — serve static site + image proxy
// Node 18+ required (built‑in fetch)
// Place your site files (index.html, style.css, app.js, libs/…) in ./public

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

// 1) Static website (./public)
app.use(cors());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// 2) Image proxy: http://localhost:3000/img?url=...
app.get("/img", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(r.status).send("Upstream error");
    const ct = r.headers.get("content-type") || "application/octet-stream";
    res.set("Content-Type", ct);
    res.set("Cache-Control", "public, max-age=3600");
    if (r.body.pipe) {
      r.body.pipe(res);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    }
  } catch (e) {
    res.status(500).send("Proxy error");
  }
});

// 3) Friendly root message (optional)
app.get("/", (req, res) => {
  res.send('✅ Server running. Open <a href="/index.html">/index.html</a> or use /img?url=...');
});

app.listen(PORT, () => {
  console.log(`🚀 Serving ./public and proxy on http://localhost:${PORT}`);
});
