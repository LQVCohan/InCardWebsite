/* =============================================================
  DeckLog importer for Card Printer Pro
  - DeckLog code/link input only
  - Tries official DeckLog view/API pages and runtime-discovered API URLs
  - Imports found card images into the existing print list with exact qty
  - ZIP download for imported DeckLog image entries
  ============================================================= */
(function () {
  const DECKLOG_PROXY_URL = "http://localhost:3000/img?url=";
  const DECKLOG_DOMAINS = [
    "https://decklog-en.bushiroad.com",
    "https://decklog.bushiroad.com",
  ];
  const MAX_DECKLOG_FETCHES = 70;
  const MAX_SCRIPT_DISCOVERY = 8;

  let lastDeckLogEntries = [];
  let lastDeckLogName = "decklog";

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
    panel.querySelector("#decklogImportBtn")?.addEventListener("click", () => {
      importDeckLogFromInput(input.value);
    });
    panel.querySelector("#decklogZipBtn")?.addEventListener("click", () => {
      downloadDeckLogZipFromInput(input.value);
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) importDeckLogFromInput(input.value);
    });
  }

  function setDeckLogStatus(message, isError = false) {
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
      setDeckLogStatus("Không tìm thấy API danh sách card của app chính.", true);
      return false;
    }
  }

  function proxifyDeckLog(url) {
    return DECKLOG_PROXY_URL + encodeURIComponent(url);
  }

  function uniq(list) {
    return [...new Set((list || []).filter(Boolean))];
  }

  function safeFileName(name) {
    return String(name || "card")
      .replace(/[\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "card";
  }

  function pad(num, width = 3) {
    return String(num).padStart(width, "0");
  }

  function normalizeQty(value) {
    const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.floor(n));
  }

  function isDeckLogUrl(url) {
    return /^https?:\/\/(decklog-en\.)?bushiroad\.com/i.test(String(url || ""));
  }

  function isDirectImageUrl(url) {
    const value = String(url || "").trim();
    return /^https?:\/\//i.test(value) && !isDeckLogUrl(value) && /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i.test(value);
  }

  function hasDirectImageInput(input) {
    return extractUrls(input).some(isDirectImageUrl);
  }

  function extractUrls(text) {
    return String(text || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  }

  function absolutize(url, baseUrl) {
    try {
      return new URL(url, baseUrl || location.href).href;
    } catch {
      return url;
    }
  }

  function extractDeckLogCode(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      for (const key of ["deck", "deck_id", "deckId", "deck_code", "code", "id"]) {
        const value = url.searchParams.get(key);
        if (value) return value.trim();
      }
      const parts = url.pathname.split("/").map((p) => p.trim()).filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || raw).trim();
    } catch {
      return raw.split(/\s+/)[0].trim();
    }
  }

  function buildDeckLogCandidateUrls(input) {
    const raw = String(input || "").trim();
    const code = extractDeckLogCode(raw);
    const encoded = encodeURIComponent(code);
    const urls = [];
    if (/^https?:\/\//i.test(raw)) urls.push(raw);

    const paths = [
      `/view/${encoded}`,
      `/deck/${encoded}`,
      `/deckview/${encoded}`,
      `/recipe/${encoded}`,
      `/${encoded}`,
      `/api/view/${encoded}`,
      `/api/view?deck_code=${encoded}`,
      `/api/view?code=${encoded}`,
      `/api/deck/${encoded}`,
      `/api/decks/${encoded}`,
      `/api/deck/view/${encoded}`,
      `/api/deck?code=${encoded}`,
      `/api/deck?id=${encoded}`,
      `/api/deck?deck_code=${encoded}`,
      `/api/decklog/${encoded}`,
      `/api/decklog?code=${encoded}`,
      `/api/decklog?deck_code=${encoded}`,
      `/api/deck_log/${encoded}`,
      `/api/deck_log?deck_code=${encoded}`,
      `/api/recipe/${encoded}`,
      `/api/recipes/${encoded}`,
      `/api/recipes?deck_code=${encoded}`,
      `/system/app/api/view/${encoded}`,
      `/system/app/api/view?deck_code=${encoded}`,
      `/system/app/api/deck/${encoded}`,
      `/system/app/api/deck?code=${encoded}`,
      `/system/app/api/deck?deck_code=${encoded}`,
      `/system/app/api/deck/show?deck_code=${encoded}`,
      `/system/app/api/deck/show?id=${encoded}`,
      `/system/app/api/decklog/show?deck_code=${encoded}`,
      `/system/app/api/deck_log/show?deck_code=${encoded}`,
      `/ajax/deck?deck_code=${encoded}`,
      `/ajax/decklog?deck_code=${encoded}`,
      `/ajax/view?deck_code=${encoded}`,
    ];

    for (const domain of DECKLOG_DOMAINS) {
      for (const path of paths) urls.push(domain + path);
    }
    return uniq(urls);
  }

  async function fetchTextWithFallback(url) {
    try {
      const direct = await fetch(url, { mode: "cors", redirect: "follow" });
      if (direct.ok) return await direct.text();
    } catch {}

    const proxied = await fetch(proxifyDeckLog(url), { redirect: "follow" });
    if (!proxied.ok) throw new Error(`HTTP ${proxied.status}`);
    return await proxied.text();
  }

  async function fetchBlobWithDeckLogFallback(url) {
    if (typeof fetchBlobWithFallback === "function") {
      try {
        return await fetchBlobWithFallback(url);
      } catch {}
    }
    try {
      const direct = await fetch(url, { mode: "cors", redirect: "follow" });
      if (direct.ok) return await direct.blob();
    } catch {}
    const proxied = await fetch(proxifyDeckLog(url), { redirect: "follow" });
    if (!proxied.ok) throw new Error(`Không tải được ảnh: ${url}`);
    return await proxied.blob();
  }

  function extractScriptUrls(html, baseUrl) {
    const scripts = [];
    const pattern = /<script[^>]+src=["']([^"']+\.js[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = pattern.exec(String(html || "")))) {
      scripts.push(absolutize(unescapeHtml(match[1]), baseUrl));
    }
    return uniq(scripts);
  }

  function buildUrlVariants(rawPath, baseUrl, code) {
    if (!rawPath || /\$\{|\{\{|\+|\[object/i.test(rawPath)) return [];
    let path = rawPath.replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(path) && !path.startsWith("/")) return [];
    if (/\.(png|jpe?g|webp|gif|svg|css|map)(\?|$)/i.test(path)) return [];
    const encoded = encodeURIComponent(code);
    const base = absolutize(path, baseUrl);
    const urls = [base];

    try {
      const u = new URL(base);
      const hasDeckParam = [...u.searchParams.keys()].some((key) => /deck|code|id/i.test(key));
      if (!hasDeckParam) {
        for (const key of ["deck_code", "code", "deck", "id"]) {
          const copy = new URL(u.href);
          copy.searchParams.set(key, code);
          urls.push(copy.href);
        }
      }
      if (!u.pathname.endsWith(`/${encoded}`)) urls.push(`${u.origin}${u.pathname.replace(/\/$/, "")}/${encoded}${u.search || ""}`);
    } catch {}

    return urls;
  }

  function discoverCandidateUrlsFromText(text, baseUrl, code) {
    const discovered = [];
    const source = String(text || "");
    const quotedPathPattern = /["'`]([^"'`]{1,220}(?:api|deck|Deck|recipe|Recipe|view|View)[^"'`]{0,220})["'`]/g;
    let match;
    while ((match = quotedPathPattern.exec(source))) {
      discovered.push(...buildUrlVariants(match[1], baseUrl, code));
    }
    return uniq(discovered);
  }

  async function discoverFromHtmlOrScript(text, sourceUrl, code, scriptBudget) {
    const discovered = discoverCandidateUrlsFromText(text, sourceUrl, code);
    const scriptUrls = extractScriptUrls(text, sourceUrl).slice(0, scriptBudget.count);
    scriptBudget.count -= scriptUrls.length;

    for (const scriptUrl of scriptUrls) {
      try {
        setDeckLogStatus(`Đang dò API DeckLog từ script...`);
        const scriptText = await fetchTextWithFallback(scriptUrl);
        discovered.push(...discoverCandidateUrlsFromText(scriptText, scriptUrl, code));
      } catch (error) {
        console.warn("Không đọc được script DeckLog", scriptUrl, error);
      }
    }
    return uniq(discovered);
  }

  function parseJsonLoose(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {}

    const scriptJsonMatches = [
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    ];
    for (const pattern of scriptJsonMatches) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        try {
          return JSON.parse(unescapeHtml(match[1].trim()));
        } catch {}
      }
    }

    const assignmentPatterns = [
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
      /window\.__NUXT__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
      /window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
    ];
    for (const pattern of assignmentPatterns) {
      const match = trimmed.match(pattern);
      if (match?.[1]) {
        try {
          return JSON.parse(match[1]);
        } catch {}
      }
    }
    return null;
  }

  function unescapeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function firstDeepValue(obj, keyNames, depth = 0) {
    if (!obj || depth > 5) return undefined;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const value = firstDeepValue(item, keyNames, depth + 1);
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    }
    if (typeof obj !== "object") return undefined;
    const lowerKeys = keyNames.map((k) => k.toLowerCase());
    for (const [key, value] of Object.entries(obj)) {
      if (lowerKeys.includes(key.toLowerCase()) && value !== undefined && value !== null && value !== "") return value;
    }
    for (const value of Object.values(obj)) {
      const nested = firstDeepValue(value, keyNames, depth + 1);
      if (nested !== undefined && nested !== null && nested !== "") return nested;
    }
    return undefined;
  }

  function firstImageUrl(obj, baseUrl, depth = 0) {
    if (!obj || depth > 5) return "";
    if (typeof obj === "string") {
      const value = obj.trim();
      const isImageLike = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(value) || /card|image|thumb|img/i.test(value);
      if (isImageLike && (/^https?:\/\//i.test(value) || value.startsWith("/"))) return absolutize(value, baseUrl);
      return "";
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const value = firstImageUrl(item, baseUrl, depth + 1);
        if (value) return value;
      }
      return "";
    }
    if (typeof obj !== "object") return "";
    for (const [key, value] of Object.entries(obj)) {
      if (/image|img|thumb|picture|card.*url|url/i.test(key)) {
        const found = firstImageUrl(value, baseUrl, depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(obj)) {
      const found = firstImageUrl(value, baseUrl, depth + 1);
      if (found) return found;
    }
    return "";
  }

  function collectCardEntriesFromJson(root, sourceUrl) {
    const entries = [];
    const seenObjects = new WeakSet();
    const qtyKeys = ["qty", "quantity", "count", "num", "number", "枚数", "card_num", "cardNum", "amount"];
    const idKeys = ["card_number", "cardNumber", "card_no", "cardNo", "card_id", "cardId", "card_code", "cardCode", "code", "id", "number"];
    const nameKeys = ["name", "card_name", "cardName", "title", "card_title", "cardTitle"];

    function visit(node, depth = 0) {
      if (!node || depth > 12) return;
      if (typeof node !== "object") return;
      if (seenObjects.has(node)) return;
      seenObjects.add(node);

      if (!Array.isArray(node)) {
        const qtyRaw = firstDeepValue(node, qtyKeys, 0);
        const codeRaw = firstDeepValue(node, idKeys, 0);
        const nameRaw = firstDeepValue(node, nameKeys, 0);
        const imageUrl = firstImageUrl(node, sourceUrl, 0);
        const qty = normalizeQty(qtyRaw || 1);
        const code = codeRaw === undefined || codeRaw === null ? "" : String(codeRaw).trim();
        const name = nameRaw === undefined || nameRaw === null ? code : String(nameRaw).trim();
        const hasCardSignal = imageUrl || /[A-Z0-9_-]+[\/.-][A-Z0-9_-]+/i.test(code) || /card/i.test(Object.keys(node).join(" "));
        const hasQtySignal = qtyRaw !== undefined || Object.keys(node).some((key) => qtyKeys.includes(key));
        if (hasCardSignal && (hasQtySignal || imageUrl)) entries.push({ code, name, qty, src: imageUrl, sourceUrl });
      }

      const children = Array.isArray(node) ? node : Object.values(node);
      for (const child of children) visit(child, depth + 1);
    }

    visit(root);
    return normalizeEntries(entries);
  }

  function parseDeckTextLines(text) {
    const entries = [];
    const lines = String(text || "").split(/\r?\n/);
    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      let match = line.match(/^([0-9]{1,3})\s*[x×*]?\s+(.+)$/i);
      if (match) {
        entries.push({ qty: normalizeQty(match[1]), code: match[2].trim(), name: match[2].trim(), src: "" });
        continue;
      }
      match = line.match(/^(.+?)\s+[x×*]?\s*([0-9]{1,3})$/i);
      if (match && /[A-Z0-9]/i.test(match[1])) entries.push({ qty: normalizeQty(match[2]), code: match[1].trim(), name: match[1].trim(), src: "" });
    }
    return normalizeEntries(entries);
  }

  function parseImageLinksFromFetchedText(text) {
    const entries = [];
    const urls = extractUrls(text).filter((url) => /\.(png|jpe?g|webp|gif|avif|bmp)(\?|#|$)/i.test(url) && !/logo|icon|favicon|sprite/i.test(url));
    for (const url of urls) {
      entries.push({
        qty: 1,
        code: safeFileName(url.split("/").pop()?.split("?")[0] || "image"),
        name: safeFileName(url.split("/").pop()?.split("?")[0] || "image"),
        src: url,
        sourceUrl: url,
      });
    }
    return normalizeEntries(entries);
  }

  function normalizeEntries(entries) {
    const map = new Map();
    for (const entry of entries) {
      const code = String(entry.code || "").trim();
      const src = String(entry.src || "").trim();
      const name = String(entry.name || code || src || "DeckLog card").trim();
      if (!code && !src && !name) continue;
      const key = src || code || name;
      const current = map.get(key);
      const qty = normalizeQty(entry.qty);
      if (current) {
        current.qty += qty;
        if (!current.src && src) current.src = src;
        if (!current.name && name) current.name = name;
      } else {
        map.set(key, { code, name, qty, src, sourceUrl: entry.sourceUrl || "" });
      }
    }
    return [...map.values()].filter((entry) => entry.qty > 0);
  }

  function buildImageCandidates(entry) {
    const candidates = [];
    if (entry.src) candidates.push(entry.src);
    const code = String(entry.code || "").trim();
    if (code && !/^https?:\/\//i.test(code)) {
      const encodedPath = code.split("/").map(encodeURIComponent).join("/");
      const encodedFile = encodeURIComponent(code);
      for (const domain of DECKLOG_DOMAINS) {
        candidates.push(`${domain}/images/card/${encodedPath}.png`);
        candidates.push(`${domain}/images/cards/${encodedPath}.png`);
        candidates.push(`${domain}/assets/images/card/${encodedPath}.png`);
        candidates.push(`${domain}/assets/image/card/${encodedPath}.png`);
        candidates.push(`${domain}/assets/img/card/${encodedPath}.png`);
        candidates.push(`${domain}/card_images/${encodedFile}.png`);
        candidates.push(`${domain}/card/${encodedFile}.png`);
      }
    }
    return uniq(candidates);
  }

  async function resolveDeckLog(input) {
    const raw = String(input || "").trim();
    if (!raw) throw new Error("Bạn chưa nhập DeckLog code/link.");
    if (hasDirectImageInput(raw)) {
      throw new Error("Ô này chỉ nhập DeckLog. Link ảnh hãy dán/kéo vào vùng nhập ảnh phía trên hoặc thả vào toàn trang.");
    }

    const pasted = parseDeckTextLines(raw);
    if (pasted.length > 1) return withImageCandidates(pasted);

    const code = extractDeckLogCode(raw);
    if (!code) throw new Error("Không nhận diện được DeckLog code/link.");

    const queue = buildDeckLogCandidateUrls(raw);
    const seen = new Set();
    const errors = [];
    const scriptBudget = { count: MAX_SCRIPT_DISCOVERY };
    let fetchCount = 0;

    while (queue.length && fetchCount < MAX_DECKLOG_FETCHES) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      fetchCount += 1;

      try {
        setDeckLogStatus(`Đang đọc DeckLog ${code} (${fetchCount}/${Math.min(MAX_DECKLOG_FETCHES, fetchCount + queue.length)})...`);
        const text = await fetchTextWithFallback(url);
        const json = parseJsonLoose(text);
        let entries = json ? collectCardEntriesFromJson(json, url) : [];
        if (!entries.length) entries = parseImageLinksFromFetchedText(text);
        if (!entries.length) entries = parseDeckTextLines(text);
        if (entries.length) return withImageCandidates(entries);

        const discovered = await discoverFromHtmlOrScript(text, url, code, scriptBudget);
        for (const candidate of discovered) {
          if (!seen.has(candidate) && queue.length < MAX_DECKLOG_FETCHES) queue.push(candidate);
        }
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    console.warn("DeckLog resolve errors", errors);
    throw new Error(`Không đọc được DeckLog (${code}). Trang DeckLog có thể không mở dữ liệu deck qua request thường; hãy thử link share /view đầy đủ hoặc text export của DeckLog.`);
  }

  function withImageCandidates(entries) {
    return entries.map((entry) => {
      const imageCandidates = buildImageCandidates(entry);
      return { ...entry, imageCandidates, src: entry.src || imageCandidates[0] || "" };
    });
  }

  async function importDeckLogFromInput(input) {
    if (!requirePrinterApi()) return;
    try {
      setDeckLogStatus("Đang đọc DeckLog...");
      const entries = await resolveDeckLog(input);
      if (!entries.length) throw new Error("DeckLog không có card hợp lệ.");
      if (typeof snapshot === "function") snapshot();

      const importedCards = entries.map((entry) => ({
        name: entry.name || entry.code || "DeckLog card",
        src: entry.src,
        qty: normalizeQty(entry.qty),
        external: true,
        cardId: entry.code || undefined,
        decklog: true,
        imageCandidates: entry.imageCandidates,
      }));

      cards.push(...importedCards);
      renderList();
      if (typeof drawLayoutPreview === "function") drawLayoutPreview();
      updateCounters();

      lastDeckLogEntries = entries;
      lastDeckLogName = extractDeckLogCode(input) || "decklog";
      const total = entries.reduce((sum, entry) => sum + normalizeQty(entry.qty), 0);
      setDeckLogStatus(`Đã nhập ${entries.length} loại card / ${total} bản in. Có thể bấm Xuất PDF/DOCX để tạo file in.`);
    } catch (error) {
      console.error(error);
      setDeckLogStatus(error.message || "Nhập DeckLog thất bại.", true);
    }
  }

  async function downloadDeckLogZipFromInput(input) {
    try {
      let entries = lastDeckLogEntries;
      const code = extractDeckLogCode(input);
      if (!entries.length || (code && code !== lastDeckLogName)) {
        setDeckLogStatus("Đang đọc DeckLog để tải ZIP...");
        entries = await resolveDeckLog(input);
        lastDeckLogEntries = entries;
        lastDeckLogName = code || "decklog";
      }
      if (!entries.length) throw new Error("Không có card DeckLog để tải ZIP.");
      await downloadImagesAsZip(entries, lastDeckLogName);
    } catch (error) {
      console.error(error);
      setDeckLogStatus(error.message || "Tải ZIP thất bại.", true);
    }
  }

  async function downloadImagesAsZip(entries, deckName) {
    const expanded = [];
    for (const entry of entries) {
      const qty = normalizeQty(entry.qty);
      for (let i = 0; i < qty; i++) expanded.push(entry);
    }
    const files = [];
    for (let index = 0; index < expanded.length; index++) {
      const entry = expanded[index];
      setDeckLogStatus(`Đang tải ảnh ${index + 1}/${expanded.length}...`);
      const blob = await fetchFirstWorkingBlob(entry.imageCandidates || [entry.src]);
      const buffer = new Uint8Array(await blob.arrayBuffer());
      const ext = extensionFromBlobOrUrl(blob, entry.src);
      const base = safeFileName(entry.code || entry.name || `card-${index + 1}`);
      files.push({ name: `${pad(index + 1)}_${base}${ext}`, data: buffer });
    }
    const zipBlob = makeZipBlob(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${safeFileName(deckName || "decklog")}_images.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDeckLogStatus(`Đã tạo ZIP gồm ${files.length} file ảnh.`);
  }

  async function fetchFirstWorkingBlob(candidates) {
    const urls = uniq(candidates || []);
    let lastError = null;
    for (const url of urls) {
      if (!url) continue;
      try {
        const blob = await fetchBlobWithDeckLogFallback(url);
        if (blob && blob.size > 0) return blob;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Không tìm thấy URL ảnh hợp lệ cho card.");
  }

  function extensionFromBlobOrUrl(blob, url) {
    const type = String(blob?.type || "").toLowerCase();
    if (type.includes("png")) return ".png";
    if (type.includes("webp")) return ".webp";
    if (type.includes("gif")) return ".gif";
    const match = String(url || "").split("?")[0].match(/\.(png|jpe?g|webp|gif|avif)$/i);
    if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
    return ".jpg";
  }

  function makeZipBlob(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of files) {
      const nameBytes = utf8(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      const crc = crc32(data);
      const localHeader = concatBytes(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes);
      localParts.push(localHeader, data);
      const centralHeader = concatBytes(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes);
      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const endRecord = concatBytes(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0));
    return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
  }

  function utf8(value) {
    return new TextEncoder().encode(String(value));
  }

  function u16(value) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value & 0xffff, true);
    return out;
  }

  function u32(value) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0, true);
    return out;
  }

  function concatBytes(...parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

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
