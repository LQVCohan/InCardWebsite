/* =============================================================
  DeckLog Browser Bridge
  Use when DeckLog blocks localhost proxy rendering.
  Flow:
  1) Drag bookmarklet to bookmarks.
  2) Open the real DeckLog page and click the bookmarklet.
  3) Return to InCard and click "Nhận deck đã gửi".
  ============================================================= */
(function () {
  const BRIDGE_ENDPOINT = "http://localhost:3000/decklog-import";
  const LATEST_ENDPOINT = "/decklog-import/latest";

  const ready = (fn) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  };

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

  function qty(value) {
    const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.floor(n));
  }

  function safeName(value) {
    return String(value || "DeckLog card")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "DeckLog card";
  }

  function normalizeEntries(entries) {
    const map = new Map();
    for (const entry of entries || []) {
      const src = String(entry?.src || entry?.url || "").trim();
      if (!/^https?:\/\//i.test(src)) continue;
      const name = safeName(entry?.name || entry?.code || src.split("/").pop()?.split("?")[0]);
      const code = safeName(entry?.code || name);
      const amount = qty(entry?.qty || entry?.quantity || entry?.count || 1);
      const current = map.get(src);
      if (current) current.qty += amount;
      else map.set(src, { src, name, code, qty: amount, imageCandidates: [src] });
    }
    return [...map.values()];
  }

  function importEntries(payload) {
    if (!requirePrinterApi()) return;
    const entries = normalizeEntries(payload?.entries || []);
    if (!entries.length) {
      setStatus("DeckLog bridge chưa có ảnh card hợp lệ.", true);
      return;
    }

    if (typeof snapshot === "function") snapshot();
    cards.push(...entries.map((entry) => ({
      name: entry.name,
      src: entry.src,
      qty: entry.qty,
      external: true,
      cardId: entry.code,
      decklog: true,
      imageCandidates: entry.imageCandidates,
    })));

    renderList();
    if (typeof drawLayoutPreview === "function") drawLayoutPreview();
    updateCounters();

    const total = entries.reduce((sum, entry) => sum + entry.qty, 0);
    setStatus(`Đã nhận DeckLog ${payload?.deckCode || ""}: ${entries.length} loại card / ${total} bản in. Bấm Xuất PDF/DOCX để tạo file in.`);
  }

  async function receiveLatestDeckLog() {
    try {
      setStatus("Đang nhận deck đã gửi từ trang DeckLog...");
      const res = await fetch(LATEST_ENDPOINT, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Chưa có deck nào được gửi từ DeckLog.");
      importEntries(data);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Không nhận được deck từ DeckLog.", true);
    }
  }

  async function importFromPastedJson() {
    const box = document.getElementById("decklogBridgeJson");
    const raw = box?.value?.trim();
    if (!raw) {
      setStatus("Bạn chưa dán JSON helper.", true);
      return;
    }
    try {
      importEntries(JSON.parse(raw));
      box.value = "";
    } catch (error) {
      console.error(error);
      setStatus("JSON helper không hợp lệ.", true);
    }
  }

  function deckLogBookmarkletRunner(endpoint) {
    (async () => {
      const absolutize = (url, base = location.href) => {
        try { return new URL(url, base).href; } catch { return url; }
      };
      const cleanName = (value) => String(value || "DeckLog card")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "DeckLog card";
      const normalizeQty = (value) => {
        const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
        return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
      };
      const firstCssUrl = (value) => {
        const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/i);
        return match?.[2] || "";
      };
      const srcFromImg = (img) => {
        const srcset = img.getAttribute("srcset") || img.dataset.srcset || "";
        const srcsetCandidate = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop();
        return absolutize(
          img.dataset.original ||
          img.dataset.src ||
          img.dataset.lazy ||
          img.dataset.url ||
          img.currentSrc ||
          img.src ||
          srcsetCandidate ||
          ""
        );
      };
      const sourceFromElement = (element) => {
        if (element.tagName === "IMG") return srcFromImg(element);
        const style = getComputedStyle(element);
        const background = firstCssUrl(style.backgroundImage) || firstCssUrl(element.getAttribute("style"));
        return absolutize(background || "");
      };
      const isNoiseUrl = (url) => {
        const value = String(url || "").toLowerCase();
        if (!value) return true;
        if (/logo|icon|favicon|sprite|banner|avatar|facebook|twitter|sns|ogp|og-image|share|thumbnail|capture|screenshot|preview|export/.test(value)) {
          return !/\/card(s)?\//.test(value) && !/card_images/.test(value);
        }
        return false;
      };
      const isVisibleCardShape = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const width = element.naturalWidth || rect.width;
        const height = element.naturalHeight || rect.height;
        const ratio = height / (width || 1);
        return rect.width >= 45 && rect.height >= 60 && width >= 45 && height >= 60 && ratio >= 1.05 && ratio <= 2.25 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
      };
      const isCardSource = (url, element) => {
        if (!/^https?:/i.test(url) || isNoiseUrl(url)) return false;
        return isVisibleCardShape(element) || /\/card(s)?\/|card_images|card.*image|\/images\//i.test(url);
      };
      const closestCardBox = (element) => {
        let node = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          if (node.querySelectorAll) {
            const imageLikeCount = [...node.querySelectorAll("img")].filter((img) => isVisibleCardShape(img)).length;
            const text = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (imageLikeCount <= 3 && text.length <= 280) return node;
          }
          node = node.parentElement;
        }
        return element.parentElement || element;
      };
      const readQty = (element) => {
        const selectors = [
          "[class*=num]",
          "[class*=count]",
          "[class*=qty]",
          "[class*=quantity]",
          "[class*=deck_num]",
          "[data-num]",
          "[data-count]",
          "[data-qty]",
          "[data-quantity]",
        ];
        let node = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          for (const selector of selectors) {
            for (const found of node.querySelectorAll?.(selector) || []) {
              const value = found.dataset?.num || found.dataset?.count || found.dataset?.qty || found.dataset?.quantity || found.textContent;
              const match = String(value || "").trim().match(/^([1-9][0-9]?)$/);
              if (match) return Number(match[1]);
            }
          }
          const text = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (text.length <= 190) {
            const values = [...text.matchAll(/(?:^|\s)([1-9][0-9]?)(?:\s|$)/g)]
              .map((match) => Number(match[1]))
              .filter((value) => value >= 1 && value <= 50);
            if (values.length) return values[values.length - 1];
          }
          node = node.parentElement;
        }
        return 1;
      };

      const map = new Map();
      const debugUrls = [];
      const addCandidate = (element) => {
        const src = sourceFromElement(element);
        if (src) debugUrls.push(src);
        if (!isCardSource(src, element)) return;
        const holder = closestCardBox(element);
        const rawName = element.getAttribute?.("alt") || element.getAttribute?.("title") || src.split("/").pop()?.split("?")[0] || "DeckLog card";
        const name = cleanName(rawName);
        const current = map.get(src) || { src, name, code: name, qty: 0 };
        current.qty += readQty(holder);
        map.set(src, current);
      };

      document.querySelectorAll("img").forEach(addCandidate);
      document.querySelectorAll("*").forEach((element) => {
        const style = getComputedStyle(element);
        if (style.backgroundImage && style.backgroundImage !== "none") addCandidate(element);
      });

      const payload = {
        source: location.href,
        deckCode: location.pathname.split("/").filter(Boolean).pop() || "decklog",
        entries: [...map.values()],
      };

      if (!payload.entries.length) {
        const debug = {
          imgCount: document.images.length,
          backgroundCount: [...document.querySelectorAll("*")].filter((element) => getComputedStyle(element).backgroundImage !== "none").length,
          sampleUrls: debugUrls.filter(Boolean).slice(0, 30),
        };
        try { await navigator.clipboard.writeText(JSON.stringify(debug, null, 2)); } catch {}
        alert("Không tìm thấy ảnh card. Đã copy debug gồm img/background URL mẫu nếu trình duyệt cho phép. Hãy gửi debug đó cho ChatGPT.");
        return;
      }

      try {
        await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        alert(`Đã gửi ${payload.entries.length} loại card về InCard. Quay lại InCard và bấm Nhận deck đã gửi.`);
      } catch (error) {
        try {
          await navigator.clipboard.writeText(JSON.stringify(payload));
          alert("Không gửi được localhost, đã copy JSON. Quay lại InCard và dán vào ô JSON helper.");
        } catch {
          prompt("Copy JSON này rồi dán vào InCard:", JSON.stringify(payload));
        }
      }
    })();
  }

  function makeBookmarkletSource() {
    return `javascript:(${deckLogBookmarkletRunner.toString()})(${JSON.stringify(BRIDGE_ENDPOINT)})`;
  }

  function installBridgePanel() {
    const decklogPanel = document.getElementById("decklogPanel");
    if (!decklogPanel || document.getElementById("decklogBridgePanel")) return;

    const panel = document.createElement("section");
    panel.id = "decklogBridgePanel";
    panel.className = "uploader small-uploader";
    panel.innerHTML = `
      <p><strong>Bridge DeckLog thật</strong></p>
      <p class="hint">Dùng khi DeckLog chặn proxy và hiện /systemError. Kéo nút helper lên thanh dấu trang, mở DeckLog thật, bấm helper, rồi quay lại đây nhận deck.</p>
      <div class="decklog-import-row">
        <a id="decklogBookmarklet" class="btn outline" href="#">Kéo nút này lên Bookmark</a>
        <button id="decklogReceiveBtn" class="btn primary" type="button">Nhận deck đã gửi</button>
        <button id="decklogPasteJsonBtn" class="btn outline" type="button">Nhập JSON helper</button>
      </div>
      <textarea id="decklogBridgeJson" class="decklog-bridge-json" rows="3" placeholder="Nếu helper không gửi được localhost, dán JSON được copy vào đây..."></textarea>
    `;

    decklogPanel.insertAdjacentElement("afterend", panel);
    panel.querySelector("#decklogBookmarklet")?.setAttribute("href", makeBookmarkletSource());
    panel.querySelector("#decklogReceiveBtn")?.addEventListener("click", receiveLatestDeckLog);
    panel.querySelector("#decklogPasteJsonBtn")?.addEventListener("click", importFromPastedJson);
  }

  ready(() => {
    installBridgePanel();
    setTimeout(installBridgePanel, 250);
  });
})();
