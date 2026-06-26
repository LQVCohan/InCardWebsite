/* =============================================================
  DeckLog importer for Card Printer Pro
  - DeckLog code/link input only
  - Uses localhost DeckLog proxy + hidden iframe to read the rendered card grid
  - Does NOT import overview/share screenshots as cards
  - Imports individual card images with exact quantity, then PDF/DOCX export uses the existing app flow
  ============================================================= */
(function () {
  const PROXY_URL = "http://localhost:3000/img?url=";
  const DECKLOG_DOMAINS = [
    "https://decklog-en.bushiroad.com",
    "https://decklog.bushiroad.com",
  ];
  const MIN_IMAGE_URLS_FOR_DECK = 8;
  const IFRAME_TIMEOUT_MS = 10000;
  const IFRAME_POLL_MS = 500;

  let lastEntries = [];
  let lastDeckName = "decklog";

  function installDeckLogPanel() {
    if (document.getElementById("decklogPanel")) return;

    const panel = document.createElement("section");
    panel.id = "decklogPanel";
    panel.className = "uploader small-uploader";
    panel.innerHTML = `
      <p><strong>Nhập DeckLog</strong></p>
      <div class="decklog-import-row">
        <input id="decklogInput" type="text" placeholder="Dán DeckLog code hoặc link /view/..." />
        <button id="decklogImportBtn" class="btn primary">Nhập DeckLog</button>
        <button id="decklogZipBtn" class="btn outline">Tải ZIP ảnh</button>
      </div>
      <p id="decklogStatus" class="hint">Ô này chỉ dành cho DeckLog. Link ảnh trực tiếp hãy dán/kéo vào vùng nhập ảnh phía trên hoặc thả vào toàn trang.</p>
    `;

    const controls = document.querySelector(".controls");
    const container = document.querySelector(".container");
    if (controls?.parentNode) controls.parentNode.insertBefore(panel, controls);
    else container?.prepend(panel);

    const input = panel.querySelector("#decklogInput");
    panel.querySelector("#decklogImportBtn")?.addEventListener("click", () => importDeckLog(input.value));
    panel.querySelector("#decklogZipBtn")?.addEventListener("click", () => downloadDeckZip(input.value));
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) importDeckLog(input.value);
    });
  }

  function setStatus(message, isError = false) {
    const el = document.getElementById("decklogStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#fca5a5" : "";
  }

  function requirePrinterApi() {
    try {
      if (!Array.isArray(cards)) throw new Error("cards missing");
      if (typeof renderList !== "function") throw new Error("renderList missing");
      if (typeof updateCounters !== "function") throw new Error("updateCounters missing");
      return true;
    } catch (error) {
      console.error(error);
      setStatus("Không tìm thấy API danh sách card của app chính.", true);
      return false;
    }
  }

  function uniq(list) {
    return [...new Set((list || []).filter(Boolean))];
  }

  function proxy(url) {
    return PROXY_URL + encodeURIComponent(url);
  }

  function safeFileName(name) {
    return String(name || "card")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "card";
  }

  function pad(num, width = 3) {
    return String(num).padStart(width, "0");
  }

  function qty(value) {
    const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.floor(n));
  }

  function urlsFrom(text) {
    return String(text || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  }

  function isDeckLogUrl(value) {
    return /^https?:\/\/(decklog-en\.)?bushiroad\.com/i.test(String(value || ""));
  }

  function isDirectImageUrl(value) {
    return /^https?:\/\//i.test(String(value || "")) && !isDeckLogUrl(value) && /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i.test(String(value));
  }

  function hasDirectImageInput(input) {
    return urlsFrom(input).some(isDirectImageUrl);
  }

  function abs(url, base) {
    try {
      return new URL(url, base || location.href).href;
    } catch {
      return url;
    }
  }

  function unescapeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function extractDeckCode(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      for (const key of ["deck", "deck_id", "deckId", "deck_code", "code", "id"]) {
        const value = url.searchParams.get(key);
        if (value) return value.trim();
      }
      const parts = url.pathname.split("/").map((part) => part.trim()).filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || raw).trim();
    } catch {
      return raw.split(/\s+/)[0].trim();
    }
  }

  function localDeckViewUrl(input) {
    const code = extractDeckCode(input);
    return `/view/${encodeURIComponent(code)}`;
  }

  async function fetchText(url) {
    try {
      const direct = await fetch(url, { mode: "cors", redirect: "follow" });
      if (direct.ok) return await direct.text();
    } catch {}
    const proxied = await fetch(proxy(url), { redirect: "follow" });
    if (!proxied.ok) throw new Error(`HTTP ${proxied.status}`);
    return await proxied.text();
  }

  async function fetchBlob(url) {
    if (typeof fetchBlobWithFallback === "function") {
      try { return await fetchBlobWithFallback(url); } catch {}
    }
    try {
      const direct = await fetch(url, { mode: "cors", redirect: "follow" });
      if (direct.ok) return await direct.blob();
    } catch {}
    const proxied = await fetch(proxy(url), { redirect: "follow" });
    if (!proxied.ok) throw new Error(`Không tải được ảnh: ${url}`);
    return await proxied.blob();
  }

  function looksLikeOverviewImage(url) {
    const value = String(url || "").toLowerCase();
    if (!value) return false;
    return /ogp|og-image|twitter|share|sns|deckimage|deck_image|deck-img|deck_img|recipe|thumbnail|capture|screenshot|preview|export|list|full|view/.test(value)
      && !/\/card(s)?\//.test(value)
      && !/card_images/.test(value);
  }

  function looksLikeCardImageUrl(url) {
    const value = String(url || "").toLowerCase();
    if (!value || looksLikeOverviewImage(value)) return false;
    if (/logo|icon|favicon|sprite|banner|avatar|facebook|twitter|x-twitter/.test(value)) return false;
    return /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value)
      && (/\/card(s)?\/|card_images|\/assets\/.*card|card.*image|\/images\//i.test(value));
  }

  function extractImgSrc(img, baseUrl) {
    const raw =
      img.getAttribute("data-original") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy") ||
      img.getAttribute("src") ||
      "";
    return abs(unescapeHtml(raw), baseUrl);
  }

  function closestSingleImageContainer(img) {
    let node = img;
    for (let depth = 0; depth < 7 && node; depth += 1) {
      if (node.querySelectorAll && node.querySelectorAll("img").length === 1) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length <= 200) return node;
      }
      node = node.parentElement;
    }
    return img.parentElement || img;
  }

  function readQtyNearImage(imgOrHolder) {
    const selectors = [
      "[class*='num']",
      "[class*='count']",
      "[class*='qty']",
      "[class*='quantity']",
      "[data-num]",
      "[data-count]",
      "[data-qty]",
      "[data-quantity]",
    ];

    let node = imgOrHolder;
    for (let depth = 0; depth < 7 && node; depth += 1) {
      for (const selector of selectors) {
        const found = node.querySelector?.(selector);
        const value = found?.dataset?.num || found?.dataset?.count || found?.dataset?.qty || found?.dataset?.quantity || found?.textContent;
        const match = String(value || "").trim().match(/^([1-9][0-9]?)$/);
        if (match) return Number(match[1]);
      }

      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length <= 120) {
        const matches = [...text.matchAll(/(?:^|\s)([1-9][0-9]?)(?:\s|$)/g)].map((match) => Number(match[1]));
        const plausible = matches.filter((value) => value >= 1 && value <= 50);
        if (plausible.length) return plausible[plausible.length - 1];
      }
      node = node.parentElement;
    }
    return 1;
  }

  function parseRenderedDeckLogDocument(doc, baseUrl) {
    const entries = [];
    if (!doc?.querySelectorAll) return entries;

    for (const img of doc.querySelectorAll("img")) {
      const src = extractImgSrc(img, baseUrl);
      if (!looksLikeCardImageUrl(src)) continue;

      const holder = closestSingleImageContainer(img);
      const amount = readQtyNearImage(holder || img);
      const rawName = img.getAttribute("alt") || img.getAttribute("title") || src.split("/").pop()?.split("?")[0] || "DeckLog card";
      entries.push({
        qty: amount,
        code: safeFileName(rawName),
        name: safeFileName(rawName),
        src,
        sourceUrl: baseUrl,
      });
    }

    return normalizeEntries(entries);
  }

  function parseRenderedDeckLogHtml(text, baseUrl) {
    if (typeof DOMParser === "undefined") return [];
    const doc = new DOMParser().parseFromString(String(text || ""), "text/html");
    return parseRenderedDeckLogDocument(doc, baseUrl);
  }

  function parseDeckText(text) {
    const entries = [];
    for (const lineRaw of String(text || "").split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      let match = line.match(/^([0-9]{1,3})\s*[x×*]?\s+(.+)$/i);
      if (match) {
        entries.push({ qty: qty(match[1]), code: match[2].trim(), name: match[2].trim(), src: "" });
        continue;
      }
      match = line.match(/^(.+?)\s+[x×*]?\s*([0-9]{1,3})$/i);
      if (match && /[A-Z0-9]/i.test(match[1])) entries.push({ qty: qty(match[2]), code: match[1].trim(), name: match[1].trim(), src: "" });
    }
    return normalizeEntries(entries);
  }

  function parseCardImageLinks(text) {
    const urls = urlsFrom(text).filter((url) => looksLikeCardImageUrl(url));
    if (uniq(urls).length < MIN_IMAGE_URLS_FOR_DECK) return [];
    return normalizeEntries(uniq(urls).map((url) => ({
      qty: 1,
      code: safeFileName(url.split("/").pop()?.split("?")[0] || "card"),
      name: safeFileName(url.split("/").pop()?.split("?")[0] || "card"),
      src: url,
      sourceUrl: url,
    })));
  }

  function normalizeEntries(entries) {
    const map = new Map();
    for (const entry of entries || []) {
      const code = String(entry.code || "").trim();
      const src = String(entry.src || "").trim();
      const name = String(entry.name || code || src || "DeckLog card").trim();
      if (!code && !src && !name) continue;
      const key = src || code || name;
      const current = map.get(key);
      const amount = qty(entry.qty);
      if (current) {
        current.qty += amount;
        if (!current.src && src) current.src = src;
        if (!current.code && code) current.code = code;
      } else {
        map.set(key, { code, name, qty: amount, src, sourceUrl: entry.sourceUrl || "" });
      }
    }
    return [...map.values()].filter((entry) => entry.qty > 0);
  }

  function isUsableDeck(entries) {
    const list = normalizeEntries(entries);
    const total = list.reduce((sum, entry) => sum + qty(entry.qty), 0);
    const hasRealCardCode = list.some((entry) => entry.code && !/^https?:\/\//i.test(entry.code) && !/\.(png|jpe?g|webp|gif|avif)$/i.test(entry.code));
    const allOverview = list.length > 0 && list.every((entry) => looksLikeOverviewImage(entry.src));
    return list.length >= 2 && total >= 2 && !allOverview && (hasRealCardCode || list.length >= MIN_IMAGE_URLS_FOR_DECK);
  }

  function imageCandidates(entry) {
    const out = [];
    if (entry.src && !looksLikeOverviewImage(entry.src)) out.push(entry.src);
    const code = String(entry.code || "").trim();
    if (code && !/^https?:\/\//i.test(code)) {
      const path = code.split("/").map(encodeURIComponent).join("/");
      const file = encodeURIComponent(code);
      for (const domain of DECKLOG_DOMAINS) {
        out.push(`${domain}/images/card/${path}.png`);
        out.push(`${domain}/images/cards/${path}.png`);
        out.push(`${domain}/assets/images/card/${path}.png`);
        out.push(`${domain}/assets/image/card/${path}.png`);
        out.push(`${domain}/assets/img/card/${path}.png`);
        out.push(`${domain}/card_images/${file}.png`);
        out.push(`${domain}/card/${file}.png`);
      }
    }
    return uniq(out);
  }

  function attachCandidates(entries) {
    return normalizeEntries(entries).map((entry) => {
      const candidates = imageCandidates(entry);
      return { ...entry, imageCandidates: candidates, src: entry.src || candidates[0] || "" };
    });
  }

  async function waitForIframeDeck(input, code) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText = "position:fixed;left:-12000px;top:0;width:1200px;height:900px;opacity:0;pointer-events:none;border:0;";

      let done = false;
      let timer = null;
      const startedAt = Date.now();
      const iframeUrl = localDeckViewUrl(input);

      const cleanup = () => {
        done = true;
        if (timer) clearTimeout(timer);
        setTimeout(() => iframe.remove(), 0);
      };

      const poll = () => {
        if (done) return;
        try {
          const doc = iframe.contentDocument;
          const title = doc?.title || "";
          const entries = parseRenderedDeckLogDocument(doc, iframeUrl);
          if (isUsableDeck(entries)) {
            cleanup();
            resolve(attachCandidates(entries));
            return;
          }
          if (/not found|404|error/i.test(title)) {
            cleanup();
            reject(new Error(`DeckLog (${code}) không mở được trong proxy local.`));
            return;
          }
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }

        if (Date.now() - startedAt >= IFRAME_TIMEOUT_MS) {
          cleanup();
          reject(new Error("DeckLog proxy chưa render được danh sách card. Hãy mở thử http://localhost:3000/view/" + code));
          return;
        }

        timer = setTimeout(poll, IFRAME_POLL_MS);
      };

      iframe.addEventListener("load", () => {
        timer = setTimeout(poll, 650);
      }, { once: true });

      document.body.appendChild(iframe);
      iframe.src = iframeUrl;
      timer = setTimeout(poll, 1000);
    });
  }

  async function resolveViaRawFetch(input, code) {
    const urls = uniq([
      input && /^https?:\/\//i.test(String(input).trim()) ? String(input).trim() : "",
      ...DECKLOG_DOMAINS.map((domain) => `${domain}/view/${encodeURIComponent(code)}`),
      ...DECKLOG_DOMAINS.map((domain) => `${domain}/api/deck?deck_code=${encodeURIComponent(code)}`),
      ...DECKLOG_DOMAINS.map((domain) => `${domain}/api/view?deck_code=${encodeURIComponent(code)}`),
    ]);

    for (const url of urls) {
      if (!url) continue;
      try {
        setStatus(`Đang thử đọc DeckLog raw: ${url}`);
        const text = await fetchText(url);
        const candidates = [
          parseRenderedDeckLogHtml(text, url),
          parseDeckText(text),
          parseCardImageLinks(text),
        ];
        for (const entries of candidates) {
          if (isUsableDeck(entries)) return attachCandidates(entries);
        }
      } catch (error) {
        console.warn("Raw DeckLog fetch failed", url, error);
      }
    }
    return [];
  }

  async function resolveDeckLog(input) {
    const raw = String(input || "").trim();
    if (!raw) throw new Error("Bạn chưa nhập DeckLog code/link.");
    if (hasDirectImageInput(raw)) throw new Error("Ô này chỉ nhập DeckLog. Link ảnh hãy dán/kéo vào vùng nhập ảnh phía trên hoặc thả vào toàn trang.");

    const pasted = parseDeckText(raw);
    if (isUsableDeck(pasted)) return attachCandidates(pasted);

    const code = extractDeckCode(raw);
    if (!code) throw new Error("Không nhận diện được DeckLog code/link.");

    try {
      setStatus(`Đang render DeckLog ${code} qua proxy local...`);
      const rendered = await waitForIframeDeck(raw, code);
      if (isUsableDeck(rendered)) return rendered;
    } catch (error) {
      console.warn("DeckLog iframe render failed", error);
      setStatus(`Proxy render chưa lấy được, đang thử raw fetch DeckLog ${code}...`);
    }

    const rawFetched = await resolveViaRawFetch(raw, code);
    if (isUsableDeck(rawFetched)) return rawFetched;

    throw new Error(`Không đọc được danh sách card từ DeckLog (${code}). Hãy thử mở http://localhost:3000/view/${code}; nếu trang đó không render card thì server local chưa proxy được DeckLog.`);
  }

  async function importDeckLog(input) {
    if (!requirePrinterApi()) return;
    try {
      setStatus("Đang đọc DeckLog...");
      const entries = await resolveDeckLog(input);
      if (!entries.length) throw new Error("DeckLog không có card hợp lệ.");
      if (typeof snapshot === "function") snapshot();

      const imported = entries.map((entry) => ({
        name: entry.name || entry.code || "DeckLog card",
        src: entry.src,
        qty: qty(entry.qty),
        external: true,
        cardId: entry.code || undefined,
        decklog: true,
        imageCandidates: entry.imageCandidates,
      }));

      cards.push(...imported);
      renderList();
      if (typeof drawLayoutPreview === "function") drawLayoutPreview();
      updateCounters();

      lastEntries = entries;
      lastDeckName = extractDeckCode(input) || "decklog";
      const total = entries.reduce((sum, entry) => sum + qty(entry.qty), 0);
      setStatus(`Đã nhập ${entries.length} loại card / ${total} bản in. Bấm Xuất PDF/DOCX để tạo file in.`);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Nhập DeckLog thất bại.", true);
    }
  }

  async function downloadDeckZip(input) {
    try {
      let entries = lastEntries;
      const code = extractDeckCode(input);
      if (!entries.length || (code && code !== lastDeckName)) {
        setStatus("Đang đọc DeckLog để tải ZIP...");
        entries = await resolveDeckLog(input);
        lastEntries = entries;
        lastDeckName = code || "decklog";
      }
      if (!entries.length) throw new Error("Không có card DeckLog để tải ZIP.");
      await downloadImagesAsZip(entries, lastDeckName);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Tải ZIP thất bại.", true);
    }
  }

  async function downloadImagesAsZip(entries, deckName) {
    const expanded = [];
    for (const entry of entries) {
      for (let i = 0; i < qty(entry.qty); i++) expanded.push(entry);
    }

    const files = [];
    for (let index = 0; index < expanded.length; index++) {
      const entry = expanded[index];
      setStatus(`Đang tải ảnh ${index + 1}/${expanded.length}...`);
      const blob = await fetchFirstBlob(entry.imageCandidates || [entry.src]);
      const data = new Uint8Array(await blob.arrayBuffer());
      const ext = extFrom(blob, entry.src);
      const base = safeFileName(entry.code || entry.name || `card-${index + 1}`);
      files.push({ name: `${pad(index + 1)}_${base}${ext}`, data });
    }

    const zip = makeZipBlob(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip);
    a.download = `${safeFileName(deckName || "decklog")}_images.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Đã tạo ZIP gồm ${files.length} file ảnh.`);
  }

  async function fetchFirstBlob(candidates) {
    let lastError = null;
    for (const url of uniq(candidates || [])) {
      if (!url || looksLikeOverviewImage(url)) continue;
      try {
        const blob = await fetchBlob(url);
        if (blob && blob.size > 0) return blob;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Không tìm thấy URL ảnh card hợp lệ.");
  }

  function extFrom(blob, url) {
    const type = String(blob?.type || "").toLowerCase();
    if (type.includes("png")) return ".png";
    if (type.includes("webp")) return ".webp";
    if (type.includes("gif")) return ".gif";
    const match = String(url || "").split("?")[0].match(/\.(png|jpe?g|webp|gif|avif)$/i);
    if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
    return ".jpg";
  }

  function makeZipBlob(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
      const name = utf8(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);
      const local = bytes(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name);
      locals.push(local, data);
      const central = bytes(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name);
      centrals.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = bytes(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0));
    return new Blob([...locals, ...centrals, end], { type: "application/zip" });
  }

  function utf8(value) { return new TextEncoder().encode(String(value)); }
  function u16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value & 0xffff, true); return out; }
  function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, true); return out; }
  function bytes(...parts) { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let pos = 0; for (const part of parts) { out.set(part, pos); pos += part.length; } return out; }

  let crcTable = null;
  function crc32(data) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[i] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installDeckLogPanel);
  else installDeckLogPanel();
})();
