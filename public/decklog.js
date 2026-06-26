/* =============================================================
  DeckLog importer for Card Printer Pro
  - DeckLog code/link input only
  - Does NOT import DeckLog overview/share screenshots as a card
  - Imports individual card entries with exact quantity when deck data is readable
  ============================================================= */
(function () {
  const PROXY_URL = "http://localhost:3000/img?url=";
  const DECKLOG_DOMAINS = [
    "https://decklog-en.bushiroad.com",
    "https://decklog.bushiroad.com",
  ];
  const MAX_FETCHES = 90;
  const MAX_SCRIPTS = 10;
  const MIN_IMAGE_URLS_FOR_DECK = 8;

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

  function candidateDeckUrls(input) {
    const raw = String(input || "").trim();
    const code = extractDeckCode(raw);
    const encoded = encodeURIComponent(code);
    const urls = [];
    if (/^https?:\/\//i.test(raw)) urls.push(raw);

    const paths = [
      `/view/${encoded}`,
      `/deck/${encoded}`,
      `/deckview/${encoded}`,
      `/recipe/${encoded}`,
      `/api/view/${encoded}`,
      `/api/view?deck_code=${encoded}`,
      `/api/view?code=${encoded}`,
      `/api/deck/${encoded}`,
      `/api/decks/${encoded}`,
      `/api/deck/view/${encoded}`,
      `/api/deck?deck_code=${encoded}`,
      `/api/deck?code=${encoded}`,
      `/api/deck?id=${encoded}`,
      `/api/decklog/${encoded}`,
      `/api/decklog?deck_code=${encoded}`,
      `/api/decklog?code=${encoded}`,
      `/api/deck_log/${encoded}`,
      `/api/deck_log?deck_code=${encoded}`,
      `/api/recipe/${encoded}`,
      `/api/recipes/${encoded}`,
      `/api/recipes?deck_code=${encoded}`,
      `/system/app/api/view/${encoded}`,
      `/system/app/api/view?deck_code=${encoded}`,
      `/system/app/api/deck/${encoded}`,
      `/system/app/api/deck?deck_code=${encoded}`,
      `/system/app/api/deck/show?deck_code=${encoded}`,
      `/system/app/api/decklog/show?deck_code=${encoded}`,
      `/system/app/api/deck_log/show?deck_code=${encoded}`,
      `/ajax/view?deck_code=${encoded}`,
      `/ajax/deck?deck_code=${encoded}`,
      `/ajax/decklog?deck_code=${encoded}`,
    ];

    for (const domain of DECKLOG_DOMAINS) {
      for (const path of paths) urls.push(domain + path);
    }
    return uniq(urls);
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

  function scriptUrls(html, baseUrl) {
    const urls = [];
    const re = /<script[^>]+src=["']([^"']+\.js[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) urls.push(abs(unescapeHtml(match[1]), baseUrl));
    return uniq(urls);
  }

  function urlVariants(path, baseUrl, code) {
    if (!path || /\$\{|\{\{|\+|\[object/i.test(path)) return [];
    const cleaned = String(path).replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(cleaned) && !cleaned.startsWith("/")) return [];
    if (/\.(png|jpe?g|webp|gif|svg|css|map)(\?|$)/i.test(cleaned)) return [];

    const out = [];
    const base = abs(cleaned, baseUrl);
    out.push(base);
    try {
      const u = new URL(base);
      const hasDeckParam = [...u.searchParams.keys()].some((key) => /deck|code|id/i.test(key));
      if (!hasDeckParam) {
        for (const key of ["deck_code", "code", "deck", "id"]) {
          const copy = new URL(u.href);
          copy.searchParams.set(key, code);
          out.push(copy.href);
        }
      }
      const encoded = encodeURIComponent(code);
      if (!u.pathname.endsWith(`/${encoded}`)) out.push(`${u.origin}${u.pathname.replace(/\/$/, "")}/${encoded}${u.search || ""}`);
    } catch {}
    return out;
  }

  function discoverUrls(text, baseUrl, code) {
    const found = [];
    const re = /["'`]([^"'`]{1,240}(?:api|deck|Deck|recipe|Recipe|view|View)[^"'`]{0,240})["'`]/g;
    let match;
    while ((match = re.exec(String(text || "")))) found.push(...urlVariants(match[1], baseUrl, code));
    return uniq(found);
  }

  async function discoverFromPage(text, sourceUrl, code, budget) {
    const discovered = discoverUrls(text, sourceUrl, code);
    const scripts = scriptUrls(text, sourceUrl).slice(0, budget.count);
    budget.count -= scripts.length;
    for (const scriptUrl of scripts) {
      try {
        setStatus("Đang dò API DeckLog từ script...");
        const js = await fetchText(scriptUrl);
        discovered.push(...discoverUrls(js, scriptUrl, code));
      } catch (error) {
        console.warn("Không đọc được script DeckLog", scriptUrl, error);
      }
    }
    return uniq(discovered);
  }

  function parseJsonLoose(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch {}

    const blocks = [
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
    ];
    for (const re of blocks) {
      const match = raw.match(re);
      if (match?.[1]) {
        try { return JSON.parse(unescapeHtml(match[1].trim())); } catch {}
      }
    }

    const assignments = [
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
      /window\.__NUXT__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
      /window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
    ];
    for (const re of assignments) {
      const match = raw.match(re);
      if (match?.[1]) {
        try { return JSON.parse(match[1]); } catch {}
      }
    }
    return null;
  }

  function unescapeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function deepValue(obj, keys, depth = 0) {
    if (!obj || depth > 5) return undefined;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const value = deepValue(item, keys, depth + 1);
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    }
    if (typeof obj !== "object") return undefined;
    const lower = keys.map((key) => key.toLowerCase());
    for (const [key, value] of Object.entries(obj)) {
      if (lower.includes(key.toLowerCase()) && value !== undefined && value !== null && value !== "") return value;
    }
    for (const value of Object.values(obj)) {
      const nested = deepValue(value, keys, depth + 1);
      if (nested !== undefined && nested !== null && nested !== "") return nested;
    }
    return undefined;
  }

  function firstImage(obj, baseUrl, depth = 0) {
    if (!obj || depth > 5) return "";
    if (typeof obj === "string") {
      const value = obj.trim();
      const imageLike = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(value) || /card|image|thumb|img/i.test(value);
      if (imageLike && (/^https?:\/\//i.test(value) || value.startsWith("/"))) return abs(value, baseUrl);
      return "";
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const value = firstImage(item, baseUrl, depth + 1);
        if (value) return value;
      }
      return "";
    }
    if (typeof obj !== "object") return "";
    for (const [key, value] of Object.entries(obj)) {
      if (/image|img|thumb|picture|card.*url|url/i.test(key)) {
        const found = firstImage(value, baseUrl, depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(obj)) {
      const found = firstImage(value, baseUrl, depth + 1);
      if (found) return found;
    }
    return "";
  }

  function looksLikeOverviewImage(url) {
    const value = String(url || "").toLowerCase();
    if (!value) return false;
    return /ogp|og-image|twitter|share|sns|deckimage|deck_image|deck-img|deck_img|recipe|thumbnail|capture|screenshot|preview|export|list|full|view/.test(value)
      && !/\/card(s)?\//.test(value)
      && !/card_images/.test(value);
  }

  function collectJsonEntries(root, sourceUrl) {
    const entries = [];
    const seen = new WeakSet();
    const qtyKeys = ["qty", "quantity", "count", "num", "number", "枚数", "card_num", "cardNum", "amount"];
    const idKeys = ["card_number", "cardNumber", "card_no", "cardNo", "card_id", "cardId", "card_code", "cardCode", "code", "id", "number"];
    const nameKeys = ["name", "card_name", "cardName", "title", "card_title", "cardTitle"];

    function visit(node, depth = 0) {
      if (!node || depth > 12 || typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);

      if (!Array.isArray(node)) {
        const keys = Object.keys(node).join(" ");
        const qtyRaw = deepValue(node, qtyKeys, 0);
        const codeRaw = deepValue(node, idKeys, 0);
        const nameRaw = deepValue(node, nameKeys, 0);
        const image = firstImage(node, sourceUrl, 0);
        const code = codeRaw === undefined || codeRaw === null ? "" : String(codeRaw).trim();
        const name = nameRaw === undefined || nameRaw === null ? code : String(nameRaw).trim();
        const hasQty = qtyRaw !== undefined || Object.keys(node).some((key) => qtyKeys.includes(key));
        const hasCardSignal = /card/i.test(keys) || /[A-Z0-9_-]+[\/.-][A-Z0-9_-]+/i.test(code) || image;
        if (hasCardSignal && hasQty && !looksLikeOverviewImage(image)) {
          entries.push({ code, name, qty: qty(qtyRaw || 1), src: image, sourceUrl });
        }
      }

      const children = Array.isArray(node) ? node : Object.values(node);
      for (const child of children) visit(child, depth + 1);
    }

    visit(root);
    return normalizeEntries(entries);
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
    const urls = urlsFrom(text)
      .filter((url) => /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url))
      .filter((url) => !/logo|icon|favicon|sprite|banner/i.test(url))
      .filter((url) => !looksLikeOverviewImage(url))
      .filter((url) => /\/card(s)?\/|card_images|\/assets\/.*card|card.*image/i.test(url));

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

  async function resolveDeckLog(input) {
    const raw = String(input || "").trim();
    if (!raw) throw new Error("Bạn chưa nhập DeckLog code/link.");
    if (hasDirectImageInput(raw)) throw new Error("Ô này chỉ nhập DeckLog. Link ảnh hãy dán/kéo vào vùng nhập ảnh phía trên hoặc thả vào toàn trang.");

    const pasted = parseDeckText(raw);
    if (isUsableDeck(pasted)) return attachCandidates(pasted);

    const code = extractDeckCode(raw);
    if (!code) throw new Error("Không nhận diện được DeckLog code/link.");

    const queue = candidateDeckUrls(raw);
    const seen = new Set();
    const scriptBudget = { count: MAX_SCRIPTS };
    const errors = [];
    let sawOverviewOnly = false;
    let count = 0;

    while (queue.length && count < MAX_FETCHES) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      count += 1;

      try {
        setStatus(`Đang đọc DeckLog ${code} (${count}/${Math.min(MAX_FETCHES, count + queue.length)})...`);
        const text = await fetchText(url);
        const json = parseJsonLoose(text);

        const candidates = [];
        if (json) candidates.push(collectJsonEntries(json, url));
        candidates.push(parseDeckText(text));
        candidates.push(parseCardImageLinks(text));

        for (const entries of candidates) {
          if (!entries.length) continue;
          if (entries.length === 1 && looksLikeOverviewImage(entries[0].src)) sawOverviewOnly = true;
          if (isUsableDeck(entries)) return attachCandidates(entries);
        }

        const discovered = await discoverFromPage(text, url, code, scriptBudget);
        for (const next of discovered) {
          if (!seen.has(next) && queue.length < MAX_FETCHES) queue.push(next);
        }
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    console.warn("DeckLog resolve errors", errors);
    if (sawOverviewOnly) throw new Error(`DeckLog (${code}) chỉ trả ảnh tổng hợp deck, chưa lấy được từng ảnh card. Cần link/API chứa danh sách card hoặc text export DeckLog để tạo file in đúng số lượng.`);
    throw new Error(`Không đọc được danh sách card từ DeckLog (${code}). Hãy thử link share /view đầy đủ hoặc text export của DeckLog.`);
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
