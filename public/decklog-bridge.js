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

  function makeBookmarkletSource() {
    const source = `(async()=>{const E='${BRIDGE_ENDPOINT}';const A=(u,b=location.href)=>{try{return new URL(u,b).href}catch{return u}};const N=s=>String(s||'DeckLog card').replace(/[\\/:*?"<>|]+/g,'_').replace(/\\s+/g,' ').trim().slice(0,100)||'DeckLog card';const Q=v=>{const n=Number(String(v??'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?Math.max(1,Math.floor(n)):1};const U=img=>{const ss=img.getAttribute('srcset')||img.dataset.srcset||'';const ssc=ss.split(',').map(x=>x.trim().split(/\\s+/)[0]).filter(Boolean).pop();return A(img.dataset.original||img.dataset.src||img.dataset.lazy||img.dataset.url||img.currentSrc||img.src||ssc||'')};const O=u=>/ogp|og-image|twitter|share|sns|deckimage|deck_image|deck-img|deck_img|recipe|thumbnail|capture|screenshot|preview|export|list|full|view|logo|icon|favicon|sprite|banner|avatar|facebook|twitter/i.test(String(u||''))&&!/\\/card(s)?\\//i.test(String(u||''))&&!/card_images/i.test(String(u||''));const D=img=>{const r=img.getBoundingClientRect();const w=img.naturalWidth||r.width;const h=img.naturalHeight||r.height;const visible=r.width>40&&r.height>55&&getComputedStyle(img).display!=='none'&&getComputedStyle(img).visibility!=='hidden';const ratio=h/(w||1);return visible&&w>=45&&h>=65&&ratio>=1.15&&ratio<=2.1};const C=(u,img)=>/^https?:/i.test(u)&&!O(u)&&(D(img)||/\\.(png|jpe?g|webp|gif|avif)(\\?|#|$)/i.test(u)||/\\/card(s)?\\/|card_images|card.*image|\\/images\\//i.test(u));const H=img=>{let n=img;for(let d=0;d<8&&n;d++){if(n.querySelectorAll){const imgs=n.querySelectorAll('img').length;const t=(n.textContent||'').replace(/\\s+/g,' ').trim();if(imgs<=3&&t.length<=260)return n}n=n.parentElement}return img.parentElement||img};const R=node=>{const sels=['[class*=num]','[class*=count]','[class*=qty]','[class*=quantity]','[class*=deck_num]','[data-num]','[data-count]','[data-qty]','[data-quantity]'];let n=node;for(let d=0;d<8&&n;d++){for(const sel of sels){for(const f of n.querySelectorAll?.(sel)||[]){const v=f.dataset?.num||f.dataset?.count||f.dataset?.qty||f.dataset?.quantity||f.textContent;const m=String(v||'').trim().match(/^([1-9][0-9]?)$/);if(m)return Number(m[1])}}const t=(n.textContent||'').replace(/\\s+/g,' ').trim();if(t.length<=180){const ms=[...t.matchAll(/(?:^|\\s)([1-9][0-9]?)(?:\\s|$)/g)].map(x=>Number(x[1])).filter(x=>x>=1&&x<=50);if(ms.length)return ms[ms.length-1]}n=n.parentElement}return 1};const map=new Map();const seen=[];for(const img of document.querySelectorAll('img')){const src=U(img);seen.push(src);if(!C(src,img))continue;const holder=H(img);const name=N(img.alt||img.title||src.split('/').pop().split('?')[0]);const item=map.get(src)||{src,name,code:name,qty:0};item.qty+=R(holder);map.set(src,item)}const payload={source:location.href,deckCode:(location.pathname.split('/').filter(Boolean).pop()||'decklog'),entries:[...map.values()]};if(!payload.entries.length){const debug={imgCount:document.images.length,sampleUrls:seen.filter(Boolean).slice(0,12)};try{await navigator.clipboard.writeText(JSON.stringify(debug,null,2))}catch{}alert('Không tìm thấy ảnh card theo bộ lọc mới. Đã copy debug URL mẫu nếu trình duyệt cho phép. Hãy gửi lại thông báo này hoặc dán debug cho ChatGPT.');return}try{await fetch(E,{method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});alert('Đã gửi '+payload.entries.length+' loại card về InCard. Quay lại InCard và bấm Nhận deck đã gửi.')}catch(e){try{await navigator.clipboard.writeText(JSON.stringify(payload));alert('Không gửi được localhost, đã copy JSON. Quay lại InCard và dán vào ô JSON helper.')}catch{prompt('Copy JSON này rồi dán vào InCard:',JSON.stringify(payload))}}})()`;
    return "javascript:" + source;
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
