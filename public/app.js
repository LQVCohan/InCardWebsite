/* =============================================================
 Card Printer Pro - app.js (FULL)
 Features:
  - IndexedDB deck manager (create/load/rename/delete/merge/update)
  - Drag & drop: zone + whole-page (only when printing 1-side)
  - Paste (Ctrl+V) image / image URL / HTML <img src="...">
  - Counters (unique / total prints)
  - One-step Undo
  - Persist & restore last settings
  - PDF export (jsPDF): normalize all images to JPEG (9 per page)
  - DOCX export (docx): proxy-aware buffer load, test file
  - Auto fallback to local libs if offline; proxy fallback for CORS
  - Back-print alignment (none/short/long), crop marks
  - 9 cards per page layout
 ============================================================= */

/* ---------------- Proxy config (Node/Express server.js) --------------- */
const PROXY_URL = "http://localhost:3000/img?url=";
const proxify = (url) => PROXY_URL + encodeURIComponent(url);
async function fetchBlobWithFallback(url) {
  // try direct
  try {
    const r = await fetch(url, { mode: "cors", redirect: "follow" });
    if (r.ok) return await r.blob();
  } catch {}
  // proxy fallback
  const r2 = await fetch(proxify(url), { redirect: "follow" });
  if (!r2.ok) throw new Error("Proxy fetch fail " + r2.status);
  return await r2.blob();
}

/* ---------------- State / constants ---------------- */
const DB_NAME = "card-printer-db";
const DB_VERSION = 1;
const DECK_STORE = "decks";
const LAST_SETTINGS_KEY = "lastSettingsV2";

let cards = []; // {name, src, qty, external?}
let backImage = null;
let dragSrcIndex = null;
let pageDragCounter = 0;
let currentDeckName = null;
let lastDocxTestOK = false;
let undoSnapshot = null;
let isInternalDrag = false;
let hoveredCardIndex = null;

/* ---------------- DOM refs ---------------- */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const pageDropOverlay = document.getElementById("pageDropOverlay");

const backSection = document.getElementById("backSection");
const backInput = document.getElementById("backInput");
const backInfo = document.getElementById("backInfo");

const cardPreset = document.getElementById("cardPreset");
const customSizeBox = document.getElementById("customSize");
const cardWInput = document.getElementById("cardW");
const cardHInput = document.getElementById("cardH");

const pageSizeSelect = document.getElementById("pageSize");
const orientationSelect = document.getElementById("orientation");
const marginInput = document.getElementById("margin");
const gapInput = document.getElementById("gap");
const bleedInput = document.getElementById("bleed");

const cropMarksSelect = document.getElementById("cropMarks");
const autoFitSelect = document.getElementById("autoFit");
const frontBackModeSelect = document.getElementById("frontBackMode");
const backFlipModeSelect = document.getElementById("backFlipMode");

const fileNameInput = document.getElementById("fileName");

const previewList = document.getElementById("previewList");
const layoutPreview = document.getElementById("layoutPreview");
const countUniqueEl = document.getElementById("countUnique");
const countTotalEl = document.getElementById("countTotal");
const emptyStateEl = document.getElementById("emptyState");

const exportPdfBtn = document.getElementById("exportPdf");
const testWordBtn = document.getElementById("testWord");
const exportDocxBtn = document.getElementById("exportDocx");
const undoBtn = document.getElementById("undoBtn");

const saveDeckBtn = document.getElementById("saveDeck");
const manageDeckBtn = document.getElementById("manageDeck");
const deckManager = document.getElementById("deckManager");
const closeDeckManager = document.getElementById("closeDeckManager");
const deckList = document.getElementById("deckList");
const newDeckName = document.getElementById("newDeckName");
const createDeckBtn = document.getElementById("createDeckBtn");

const exportJsonBtn = document.getElementById("exportJson");
const exportYdkBtn = document.getElementById("exportYdk");
const importJsonBtn = document.getElementById("importBtn");
const importJsonInput = document.getElementById("importJson");
const shortcutDeleteInput = document.getElementById("shortcutDelete");
const shortcutIncInput = document.getElementById("shortcutInc");
const shortcutDecInput = document.getElementById("shortcutDec");

const updateDeckBtn = document.getElementById("updateDeckBtn");
const currentDeckNameEl = document.getElementById("currentDeckName");
const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = document.getElementById("imageViewerImg");
const closeImageViewer = document.getElementById("closeImageViewer");

/* ---------------- Helpers: Undo & Counters ---------------- */
function snapshot() {
  undoSnapshot = JSON.stringify({
    cards,
    backImage,
    settings: grabSettings(),
    currentDeckName,
  });
}
function undoOnce() {
  if (!undoSnapshot) {
    alert("Không có thao tác để hoàn tác.");
    return;
  }
  try {
    const s = JSON.parse(undoSnapshot);
    cards = s.cards || [];
    backImage = s.backImage || null;
    applySettings(s.settings || {});
    currentDeckName = s.currentDeckName || null;
    currentDeckNameEl.innerHTML = `🗂 Deck: <em>${
      currentDeckName || "Chưa chọn"
    }</em>`;
    updateDeckBtn.disabled = !currentDeckName;
    renderList();
    drawLayoutPreview();
    updateCounters();
    undoSnapshot = null;
  } catch {
    alert("Hoàn tác thất bại.");
  }
}
undoBtn.addEventListener("click", undoOnce);

function updateCounters() {
  const unique = cards.length;
  const total = cards.reduce((s, c) => s + (Number(c.qty) || 0), 0);
  if (countUniqueEl) countUniqueEl.textContent = String(unique);
  if (countTotalEl) countTotalEl.textContent = String(total);
  updateActionButtons();
}

function updateActionButtons() {
  if (exportYdkBtn) {
    const hasYdkCards = cards.some((card) => card.cardId);
    exportYdkBtn.disabled = !hasYdkCards;
    exportYdkBtn.title = hasYdkCards
      ? "Xuất file YDK"
      : "Chỉ khả dụng khi có card từ .ydk";
  }
}

/* ---------------- IndexedDB ---------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DECK_STORE)) {
        const store = db.createObjectStore(DECK_STORE, { keyPath: "name" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}
async function idbSaveDeck(name, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    tx.objectStore(DECK_STORE).put({ name, ...data, updatedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetDeck(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readonly");
    const req = tx.objectStore(DECK_STORE).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAllDecks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readonly");
    const req = tx.objectStore(DECK_STORE).getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}
async function idbDeleteDeck(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    tx.objectStore(DECK_STORE).delete(name);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbRenameDeck(oldName, newName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, "readwrite");
    const store = tx.objectStore(DECK_STORE);
    const getReq = store.get(oldName);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (!data) return reject(new Error("Deck không tồn tại"));
      store.delete(oldName);
      data.name = newName;
      data.updatedAt = Date.now();
      store.put(data);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Settings ---------------- */
function grabSettings() {
  return {
    cardPreset: cardPreset.value,
    cardW: cardWInput.value,
    cardH: cardHInput.value,
    pageSize: pageSizeSelect.value,
    orientation: orientationSelect.value,
    margin: marginInput.value,
    gap: gapInput.value,
    bleed: bleedInput.value,
    cropMarks: cropMarksSelect.value,
    autoFit: autoFitSelect.value,
    frontBackMode: frontBackModeSelect.value,
    backFlipMode: backFlipModeSelect.value,
    fileName: fileNameInput.value,
    shortcutDelete: shortcutDeleteInput?.value,
    shortcutInc: shortcutIncInput?.value,
    shortcutDec: shortcutDecInput?.value,
  };
}
function applySettings(s) {
  if (s.cardPreset) cardPreset.value = s.cardPreset;
  if (cardPreset.value === "custom") customSizeBox.classList.remove("hidden");
  else customSizeBox.classList.add("hidden");

  if (s.cardW) cardWInput.value = s.cardW;
  if (s.cardH) cardHInput.value = s.cardH;
  if (s.pageSize) pageSizeSelect.value = s.pageSize;
  if (s.orientation) orientationSelect.value = s.orientation;
  if (s.margin) marginInput.value = s.margin;
  if (s.gap) gapInput.value = s.gap;
  if (s.bleed) bleedInput.value = s.bleed;
  if (s.cropMarks) cropMarksSelect.value = s.cropMarks;
  if (s.autoFit) autoFitSelect.value = s.autoFit;
  if (s.frontBackMode) frontBackModeSelect.value = s.frontBackMode;
  if (s.backFlipMode) backFlipModeSelect.value = s.backFlipMode;
  if (s.fileName) fileNameInput.value = s.fileName;
  if (shortcutDeleteInput)
    shortcutDeleteInput.value = (s.shortcutDelete || "E").toUpperCase();
  if (shortcutIncInput)
    shortcutIncInput.value = (s.shortcutInc || "D").toUpperCase();
  if (shortcutDecInput)
    shortcutDecInput.value = (s.shortcutDec || "F").toUpperCase();

  enforceBackSettings();
  drawLayoutPreview();
}
function saveLastSettings() {
  localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(grabSettings()));
}
function loadLastSettings() {
  const raw = localStorage.getItem(LAST_SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function enforceBackSettings() {
  const mode = frontBackModeSelect.value;
  if (mode === "front-only") {
    backSection.style.display = "none";
    backFlipModeSelect.disabled = true;
    backFlipModeSelect.value = "none";
  } else if (mode === "back-only" || mode === "front-back") {
    backSection.style.display = "block";
    backFlipModeSelect.disabled = false;
  }
}

function normalizeShortcutInput(inputEl, fallback) {
  if (!inputEl) return fallback;
  const raw = String(inputEl.value || "").trim().toUpperCase();
  const normalized = raw ? raw[0] : fallback;
  inputEl.value = normalized;
  return normalized;
}

function getShortcutValue(inputEl, fallback) {
  if (!inputEl) return fallback;
  const raw = String(inputEl.value || "").trim().toUpperCase();
  return raw ? raw[0] : fallback;
}

/* ---------------- Migration from old localStorage ---------------- */
async function migrateOldDecksIfAny() {
  const exist = await idbGetAllDecks();
  if (exist && exist.length > 0) return;
  const cardDeckProRaw = localStorage.getItem("cardDeckPro");
  if (cardDeckProRaw) {
    try {
      await idbSaveDeck("deck-cũ", JSON.parse(cardDeckProRaw));
    } catch {}
  }
  const deckListAllRaw = localStorage.getItem("deckListAll");
  if (deckListAllRaw) {
    try {
      const all = JSON.parse(deckListAllRaw);
      for (const name of Object.keys(all)) {
        await idbSaveDeck(name, all[name]);
      }
    } catch {}
  }
}

/* ---------------- Files & URLs ---------------- */
function isYdkFile(file) {
  const name = file.name?.toLowerCase?.() || "";
  return name.endsWith(".ydk");
}

function parseYdkText(text) {
  // .ydk thường có các section: #main, #extra, !side; mỗi dòng là ID card.
  const lines = text.split(/\r?\n/);
  const order = [];
  const counts = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("!")) continue;
    if (!/^\d+$/.test(line)) continue;
    if (!counts.has(line)) {
      counts.set(line, 0);
      order.push(line);
    }
    counts.set(line, counts.get(line) + 1);
  }
  return order.map((id) => ({ id, qty: counts.get(id) || 1 }));
}

function buildYdkImageUrl(id) {
  return `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function parseYdkFile(file) {
  const text = await readFileText(file);
  return parseYdkText(text).map((entry) => ({
    name: `ID ${entry.id}`,
    src: buildYdkImageUrl(entry.id),
    qty: entry.qty,
    external: true,
    cardId: entry.id,
  }));
}

async function handleFiles(fileList) {
  const validExt = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".avif",
    ".heic",
  ];
  const allFiles = Array.from(fileList);
  const ydkFiles = allFiles.filter(isYdkFile);
  const imageFiles = allFiles.filter((f) => {
    const name = f.name?.toLowerCase?.() || "";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    return (f.type && f.type.startsWith("image/")) || validExt.includes(ext);
  });

  if (!ydkFiles.length && !imageFiles.length) {
    alert("Không có ảnh hoặc file .ydk hợp lệ.");
    return;
  }

  snapshot();

  if (ydkFiles.length) {
    const ydkCards = [];
    for (const file of ydkFiles) {
      try {
        const parsed = await parseYdkFile(file);
        ydkCards.push(...parsed);
      } catch (e) {
        console.warn("Không đọc được file .ydk:", file?.name, e);
        alert(`Không đọc được file .ydk: ${file?.name || "unknown"}`);
      }
    }
    if (ydkCards.length) {
      cards.push(...ydkCards);
      renderList();
      drawLayoutPreview();
      updateCounters();
    }
  }

  if (imageFiles.length) {
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        cards.push({
          name: file.name || "image",
          src: evt.target.result,
          qty: 1,
          external: false,
        });
        renderList();
        drawLayoutPreview();
        updateCounters();
      };
      reader.readAsDataURL(file);
    });
  }
}

async function handleUrlImage(url) {
  const clean = url.trim();
  const isImageUrl = /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(
    clean.split("?")[0]
  );
  if (!isImageUrl) {
    alert("Link không phải ảnh trực tiếp (.png/.jpg/.webp…).");
    return;
  }
  snapshot();
  try {
    const blob = await fetchBlobWithFallback(clean);
    const reader = new FileReader();
    reader.onload = (evt) => {
      cards.push({
        name: clean.split("/").pop() || "image",
        src: evt.target.result,
        qty: 1,
        external: false,
      });
      renderList();
      drawLayoutPreview();
      updateCounters();
    };
    reader.readAsDataURL(blob);
  } catch (e) {
    console.warn("URL ảnh không tải được (kể cả proxy):", clean, e);
    alert(
      "Không tải được ảnh (kể cả qua proxy). Hãy lưu ảnh về máy rồi kéo file vào."
    );
  }
}

/* ---------------- Paste (Ctrl + V) ---------------- */
function isTypingIntoField() {
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = (ae.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || ae.isContentEditable;
}
document.addEventListener("paste", async (e) => {
  if (isTypingIntoField()) return;
  const cd = e.clipboardData;
  if (!cd) return;

  const items = Array.from(cd.items || []);
  const imageFiles = items
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (imageFiles.length) {
    e.preventDefault();
    handleFiles(imageFiles);
    return;
  }

  const text = cd.getData("text/plain")?.trim();
  if (text && /^https?:\/\//i.test(text)) {
    e.preventDefault();
    handleUrlImage(text);
    return;
  }

  const html = cd.getData("text/html");
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) {
      e.preventDefault();
      handleUrlImage(m[1]);
    }
  }
});

/* ---------------- Dropzone small ---------------- */
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (isInternalDrag) return;
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () =>
  dropzone.classList.remove("dragover")
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (isInternalDrag) return;
  if (e.dataTransfer?.types?.includes("text/x-card-printer")) return;
  const url =
    e.dataTransfer.getData("text/uri-list") ||
    e.dataTransfer.getData("text/plain");
  if (url) {
    handleUrlImage(url);
    return;
  }
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

/* ---------------- Whole-page drag overlay (only 1-side) ---------------- */
document.addEventListener("dragenter", () => {
  if (frontBackModeSelect.value === "front-back") return;
  if (isInternalDrag) return;
  pageDragCounter++;
  pageDropOverlay.classList.add("show");
});
document.addEventListener("dragleave", () => {
  if (frontBackModeSelect.value === "front-back") return;
  pageDragCounter = Math.max(0, pageDragCounter - 1);
  if (pageDragCounter === 0) pageDropOverlay.classList.remove("show");
});
document.addEventListener("dragover", (e) => {
  if (frontBackModeSelect.value === "front-back") return;
  if (isInternalDrag) return;
  e.preventDefault();
});
document.addEventListener("drop", (e) => {
  if (frontBackModeSelect.value === "front-back") return;
  e.preventDefault();
  pageDragCounter = 0;
  pageDropOverlay.classList.remove("show");
  if (isInternalDrag) return;
  if (e.dataTransfer?.types?.includes("text/x-card-printer")) return;
  const url =
    e.dataTransfer.getData("text/uri-list") ||
    e.dataTransfer.getData("text/plain");
  if (url && /^https?:\/\//i.test(url.trim())) {
    handleUrlImage(url.trim());
    return;
  }
  if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
});
window.addEventListener("blur", () => {
  pageDragCounter = 0;
  pageDropOverlay.classList.remove("show");
});
document.addEventListener("dragend", () => {
  isInternalDrag = false;
});

if (shortcutDeleteInput) {
  shortcutDeleteInput.addEventListener("input", () => {
    normalizeShortcutInput(shortcutDeleteInput, "E");
    saveLastSettings();
  });
}
if (shortcutIncInput) {
  shortcutIncInput.addEventListener("input", () => {
    normalizeShortcutInput(shortcutIncInput, "D");
    saveLastSettings();
  });
}
if (shortcutDecInput) {
  shortcutDecInput.addEventListener("input", () => {
    normalizeShortcutInput(shortcutDecInput, "F");
    saveLastSettings();
  });
}

/* ---------------- Back image upload ---------------- */
backInput.addEventListener("change", (e) => {
  snapshot();
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    backImage = evt.target.result;
    backInfo.textContent = "Đã chọn mặt sau.";
  };
  reader.readAsDataURL(f);
});

/* ---------------- Render list & reorder ---------------- */
function renderList() {
  previewList.innerHTML = "";
  if (emptyStateEl) {
    emptyStateEl.classList.toggle("hidden", cards.length > 0);
  }
  cards.forEach((card, index) => {
    const li = document.createElement("li");
    li.className = "preview-item";
    li.draggable = true;
    li.dataset.index = index;
    li.innerHTML = `
      <img src="${card.src}" alt="card ${index + 1}" draggable="false" loading="lazy">
      <div class="preview-meta">
        <span>#${index + 1}${
      card.external ? ' · <span style="color:#38bdf8">URL</span>' : ""
    }</span>
        <div class="qty-group" data-idx="${index}">
          <button class="qty-btn" data-action="dec" data-idx="${index}">−</button>
          <input class="qty-input" type="number" min="1" value="${
            card.qty
          }" data-qty="${index}">
          <button class="qty-btn" data-action="inc" data-idx="${index}">+</button>
        </div>
        <button class="remove" data-remove="${index}">×</button>
      </div>
      <div class="preview-meta"><span title="${card.name}">${shortName(
      card.name
    )}</span></div>
    `;
    li.addEventListener("dragstart", handleDragStart);
    li.addEventListener("dragend", handleDragEnd);
    li.addEventListener("dragover", handleDragOver);
    li.addEventListener("drop", handleDrop);
    previewList.appendChild(li);
  });
}
function shortName(name) {
  if (!name) return "";
  return name.length > 16 ? name.slice(0, 14) + "…" : name;
}
function handleDragStart(e) {
  snapshot();
  isInternalDrag = true;
  if (e?.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-card-printer", "1");
  }
  dragSrcIndex = +this.dataset.index;
}
function handleDragEnd() {
  isInternalDrag = false;
}
function handleDragOver(e) {
  e.preventDefault();
}
function handleDrop() {
  const targetIndex = +this.dataset.index;
  if (dragSrcIndex === targetIndex) return;
  const moved = cards.splice(dragSrcIndex, 1)[0];
  cards.splice(targetIndex, 0, moved);
  renderList();
  drawLayoutPreview();
  updateCounters();
}
previewList.addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    snapshot();
    const idx = +rm.dataset.remove;
    cards.splice(idx, 1);
    renderList();
    drawLayoutPreview();
    updateCounters();
    return;
  }
  const btn = e.target.closest(".qty-btn");
  if (btn) {
    snapshot();
    const idx = +btn.dataset.idx;
    const action = btn.dataset.action;
    const card = cards[idx];
    if (!card) return;
    if (action === "inc") card.qty += 1;
    else if (action === "dec") card.qty = Math.max(1, card.qty - 1);
    renderList();
    updateCounters();
    return;
  }
  const targetImg = e.target.closest("img");
  if (targetImg && imageViewer && imageViewerImg) {
    imageViewerImg.src = targetImg.src;
    imageViewerImg.alt = targetImg.alt || "Card preview";
    imageViewer.classList.remove("hidden");
  }
});
previewList.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const item = img.closest(".preview-item");
    if (!item) return;
    const idx = Number(item.dataset.index);
    const card = cards[idx];
    if (!card || card.errorNotified) return;
    card.errorNotified = true;
    alert(`Không tải được ảnh: ${card.name || "unknown"}`);
  },
  true
);
previewList.addEventListener("mouseover", (e) => {
  const item = e.target.closest(".preview-item");
  if (!item) return;
  hoveredCardIndex = Number(item.dataset.index);
});
previewList.addEventListener("mouseout", (e) => {
  const item = e.target.closest(".preview-item");
  if (!item) return;
  if (item.contains(e.relatedTarget)) return;
  hoveredCardIndex = null;
});
previewList.addEventListener("input", (e) => {
  const qtyEl = e.target.closest("[data-qty]");
  if (!qtyEl) return;
  snapshot();
  const idx = +qtyEl.dataset.qty;
  const val = Math.max(1, +qtyEl.value);
  cards[idx].qty = val;
  updateCounters();
});
if (closeImageViewer) {
  closeImageViewer.addEventListener("click", () =>
    imageViewer?.classList.add("hidden")
  );
}
if (imageViewer) {
  imageViewer.addEventListener("click", (e) => {
    if (e.target === imageViewer) imageViewer.classList.add("hidden");
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && imageViewer) imageViewer.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  if (isTypingIntoField()) return;
  if (imageViewer && !imageViewer.classList.contains("hidden")) return;
  if (hoveredCardIndex === null || hoveredCardIndex === undefined) return;
  const card = cards[hoveredCardIndex];
  if (!card) return;
  const key = e.key.toUpperCase();
  const delKey = getShortcutValue(shortcutDeleteInput, "E");
  const incKey = getShortcutValue(shortcutIncInput, "D");
  const decKey = getShortcutValue(shortcutDecInput, "F");
  if (key === delKey) {
    e.preventDefault();
    snapshot();
    cards.splice(hoveredCardIndex, 1);
    renderList();
    drawLayoutPreview();
    updateCounters();
  } else if (key === incKey) {
    e.preventDefault();
    snapshot();
    card.qty += 1;
    renderList();
    updateCounters();
  } else if (key === decKey) {
    e.preventDefault();
    snapshot();
    card.qty = Math.max(1, card.qty - 1);
    renderList();
    updateCounters();
  }
});

/* ---------------- Settings change handlers ---------------- */
cardPreset.addEventListener("change", () => {
  snapshot();
  if (cardPreset.value === "custom") customSizeBox.classList.remove("hidden");
  else {
    customSizeBox.classList.add("hidden");
    const [w, h] = cardPreset.value.split("x").map(Number);
    cardWInput.value = w;
    cardHInput.value = h;
  }
  drawLayoutPreview();
  saveLastSettings();
});
[
  pageSizeSelect,
  orientationSelect,
  marginInput,
  gapInput,
  bleedInput,
  cardWInput,
  cardHInput,
  cropMarksSelect,
  autoFitSelect,
  shortcutDeleteInput,
  shortcutIncInput,
  shortcutDecInput,
].forEach((el) =>
  el?.addEventListener("change", () => {
    snapshot();
    drawLayoutPreview();
    saveLastSettings();
  })
);

frontBackModeSelect.addEventListener("change", () => {
  snapshot();
  enforceBackSettings();
  saveLastSettings();
});
backFlipModeSelect.addEventListener("change", () => {
  snapshot();
  saveLastSettings();
});

/* ---------------- Layout preview (rough) ---------------- */
function drawLayoutPreview() {
  const ctx = layoutPreview.getContext("2d");
  const page = pageSizeSelect.value;
  const orient = orientationSelect.value;
  let pw = page === "a4" ? 210 : 216;
  let ph = page === "a4" ? 297 : 279;
  if (orient === "landscape") [pw, ph] = [ph, pw];

  ctx.clearRect(0, 0, layoutPreview.width, layoutPreview.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, layoutPreview.width, layoutPreview.height);
  ctx.strokeStyle = "#888";
  ctx.strokeRect(0, 0, layoutPreview.width, layoutPreview.height);

  const margin = +marginInput.value;
  const gap = +gapInput.value;
  const bleed = +bleedInput.value;
  const cardW = +cardWInput.value + bleed * 2;
  const cardH = +cardHInput.value + bleed * 2;
  const cols = 3,
    rows = 3;

  const scaleX = layoutPreview.width / pw;
  const scaleY = layoutPreview.height / ph;
  const s = Math.min(scaleX, scaleY);
  const startX = margin * s,
    startY = margin * s;

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (cardW + gap) * s;
      const y = startY + r * (cardH + gap) * s;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(x, y, cardW * s, cardH * s);
    }
}

/* ---------------- PDF export (preflight JPEG) ---------------- */
function expandCards(list) {
  const out = [];
  list.forEach((c) => {
    for (let i = 0; i < c.qty; i++) out.push(c);
  });
  return out;
}
function maybeFlipOrder(arr, mode, cols) {
  if (mode === "none") return arr;
  const result = [];
  for (let i = 0; i < arr.length; i += 9) {
    const page = arr.slice(i, i + 9);
    if (mode === "short") {
      const converted = [];
      for (let r = 0; r < 3; r++) {
        const row = page.slice(r * cols, r * cols + cols).reverse();
        converted.push(...row);
      }
      result.push(...converted);
    } else if (mode === "long") result.push(...page.reverse());
  }
  return result;
}
/* ============ Helpers cho PDF ============ */

// mở ảnh (ưu tiên trực tiếp; nếu bạn có PROXY_URL thì thêm fallback)
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// chuyển mọi định dạng (png/webp/avif/…) -> JPEG dataURL để jsPDF chắc chắn nhận
async function toJPEGDataURL(src, quality = 1) {
  // thử load trực tiếp
  try {
    const img = await loadImageEl(src);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width || 1;
    c.height = img.naturalHeight || img.height || 1;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/jpeg", quality);
  } catch (e) {
    // nếu bạn có proxy: bật fallback qua proxy
    if (typeof PROXY_URL === "string" && /^https?:\/\//i.test(src)) {
      const proxied = PROXY_URL + encodeURIComponent(src);
      const img = await loadImageEl(proxied);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || img.width || 1;
      c.height = img.naturalHeight || img.height || 1;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0);
      return c.toDataURL("image/jpeg", quality);
    }
    throw e;
  }
}

// chuẩn hoá danh sách src -> JPEG dataURL (nếu lỗi trả null để vẫn xuất tiếp)
async function normalizeImagesForPrint(srcArray) {
  const out = [];
  for (const src of srcArray) {
    try {
      const jpeg = await toJPEGDataURL(src);
      out.push(jpeg && jpeg.startsWith("data:image/jpeg") ? jpeg : null);
    } catch {
      out.push(null);
    }
  }
  return out;
}

// bung số lượng (qty) -> mảng 1-1 theo số bản in
function expandCards(list) {
  const out = [];
  list.forEach((c) => {
    for (let i = 0; i < (c.qty || 1); i++) out.push(c);
  });
  return out;
}

// đảo thứ tự mặt sau theo kiểu đóng gáy
function maybeFlipOrder(arr, mode, cols = 3) {
  if (mode === "none") return arr.slice();
  const result = [];
  for (let i = 0; i < arr.length; i += 9) {
    const page = arr.slice(i, i + 9);
    if (mode === "short") {
      // đảo từng hàng
      const converted = [];
      for (let r = 0; r < 3; r++) {
        const row = page.slice(r * cols, r * cols + cols).reverse();
        converted.push(...row);
      }
      result.push(...converted);
    } else if (mode === "long") {
      // đảo cả trang
      result.push(...page.reverse());
    }
  }
  return result;
}

// vẽ dấu cắt
function drawCrop(pdf, x, y, w, h, mode) {
  pdf.setDrawColor(120);
  pdf.setLineWidth(0.18);
  const len = 3;
  if (mode === "short") {
    pdf.line(x, y, x + len, y);
    pdf.line(x + w - len, y, x + w, y);
    pdf.line(x, y + h, x + len, y + h);
    pdf.line(x + w - len, y + h, x + w, y + h);
    pdf.line(x, y, x, y + len);
    pdf.line(x, y + h - len, x, y + h);
    pdf.line(x + w, y, x + w, y + len);
    pdf.line(x + w, y + h - len, x + w, y + h);
  } else if (mode === "full") {
    pdf.line(x, y, x + w, y);
    pdf.line(x, y + h, x + w, y + h);
    pdf.line(x, y, x, y + h);
    pdf.line(x + w, y, x + w, y + h);
  }
}

// in 1 mặt với dữ liệu đã chuẩn hoá JPEG (null = ô trống)
async function printSide_PRENORMALIZED(pdf, dataUrls, opts) {
  const { cardWmm, cardHmm, margin, gap, cols, rows, cropMode } = opts;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const perPage = cols * rows;

  let x = margin,
    y = margin,
    count = 0;
  for (let i = 0; i < dataUrls.length; i++) {
    const src = dataUrls[i];
    if (src) {
      try {
        pdf.addImage(src, "JPEG", x, y, cardWmm, cardHmm);
      } catch {}
    }
    if (cropMode !== "none") drawCrop(pdf, x, y, cardWmm, cardHmm, cropMode);

    count++;
    x += cardWmm + gap;
    if (count % cols === 0) {
      x = margin;
      y += cardHmm + gap;
    }
    if (count === perPage && i !== dataUrls.length - 1) {
      pdf.addPage();
      x = margin;
      y = margin;
      count = 0;
    }
    if (y + cardHmm + margin > pageH) {
      pdf.addPage();
      x = margin;
      y = margin;
      count = 0;
    }
  }
}

/* ============ HÀM XUẤT PDF ============ */
/* Cần jsPDF (đã load qua CDN/local), và các biến DOM sẵn có:
   - cardWInput, cardHInput, marginInput, gapInput, bleedInput,
     pageSizeSelect, orientationSelect, cropMarksSelect, autoFitSelect,
     frontBackModeSelect, backFlipModeSelect, fileNameInput
   - mảng cards [{src, qty}], biến backImage
*/
exportPdfBtn.addEventListener("click", async () => {
  if (!window.jspdf) {
    alert("Chưa nạp jsPDF.");
    return;
  }
  if (cards.length === 0) {
    alert("Chưa có card nào.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const orientation = orientationSelect.value;
  const format = pageSizeSelect.value === "a4" ? "a4" : "letter";
  const pdf = new jsPDF({ orientation, unit: "mm", format });

  let pageW = pdf.internal.pageSize.getWidth();
  let pageH = pdf.internal.pageSize.getHeight();

  const margin = +marginInput.value;
  const gap = +gapInput.value;
  const bleed = +bleedInput.value;
  const cropMode = cropMarksSelect.value;
  const autoFit = autoFitSelect.value === "on";

  let cardWmm = +cardWInput.value + bleed * 2;
  let cardHmm = +cardHInput.value + bleed * 2;

  const cols = 3,
    rows = 3;

  // co giãn để vừa 9 tấm
  if (autoFit) {
    const needW = margin * 2 + cols * cardWmm + (cols - 1) * gap;
    const needH = margin * 2 + rows * cardHmm + (rows - 1) * gap;
    const scaleW = pageW / needW,
      scaleH = pageH / needH;
    const scale = Math.min(scaleW, scaleH, 1);
    cardWmm *= scale;
    cardHmm *= scale;
  }

  const expanded = expandCards(cards);
  const mode = frontBackModeSelect.value;

  // chuẩn hoá ảnh trước khi in
  const frontSrcs = expanded.map((c) => c.src);
  const normFront = await normalizeImagesForPrint(frontSrcs);

  let normBack = null;
  if (backImage && (mode === "back-only" || mode === "front-back")) {
    try {
      normBack = await toJPEGDataURL(backImage);
    } catch {
      normBack = null;
    }
  }

  const missing =
    normFront.filter((v) => !v).length + (backImage && !normBack ? 1 : 0);
  if (missing > 0) {
    alert(
      `${missing} ảnh không thể nhúng (thường do CORS/định dạng). Khuyên: tải ảnh về máy rồi kéo file vào để in đầy đủ.`
    );
  }

  if (mode === "front-only") {
    await printSide_PRENORMALIZED(pdf, normFront, {
      cardWmm,
      cardHmm,
      margin,
      gap,
      cols,
      rows,
      cropMode,
    });
  } else if (mode === "back-only") {
    if (!normBack) {
      alert("Chưa chuẩn hoá được ảnh mặt sau.");
      return;
    }
    await printSide_PRENORMALIZED(
      pdf,
      normFront.map(() => normBack),
      { cardWmm, cardHmm, margin, gap, cols, rows, cropMode }
    );
  } else {
    // mặt trước
    await printSide_PRENORMALIZED(pdf, normFront, {
      cardWmm,
      cardHmm,
      margin,
      gap,
      cols,
      rows,
      cropMode,
    });
    // mặt sau
    if (normBack) {
      pdf.addPage();
      const backsOrder = maybeFlipOrder(
        normFront,
        backFlipModeSelect.value,
        cols
      ).map(() => normBack);
      await printSide_PRENORMALIZED(pdf, backsOrder, {
        cardWmm,
        cardHmm,
        margin,
        gap,
        cols,
        rows,
        cropMode,
      });
    }
  }

  pdf.save((fileNameInput.value || "cards") + ".pdf");
});

async function printSide_PRENORMALIZED(pdf, dataUrls, opts) {
  const { cardWmm, cardHmm, margin, gap, cols, rows, cropMode } = opts;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const perPage = cols * rows;

  let x = margin,
    y = margin,
    count = 0;
  for (let i = 0; i < dataUrls.length; i++) {
    const src = dataUrls[i];
    if (src) {
      try {
        pdf.addImage(src, "JPEG", x, y, cardWmm, cardHmm);
      } catch {}
    }
    if (cropMode !== "none") drawCrop(pdf, x, y, cardWmm, cardHmm, cropMode);

    count++;
    x += cardWmm + gap;
    if (count % cols === 0) {
      x = margin;
      y += cardHmm + gap;
    }
    if (count === perPage && i !== dataUrls.length - 1) {
      pdf.addPage();
      x = margin;
      y = margin;
      count = 0;
    }
    if (y + cardHmm + margin > pageH) {
      pdf.addPage();
      x = margin;
      y = margin;
      count = 0;
    }
  }
}
function drawCrop(pdf, x, y, w, h, mode) {
  pdf.setDrawColor(120);
  pdf.setLineWidth(0.18);
  const len = 3;
  if (mode === "short") {
    pdf.line(x, y, x + len, y);
    pdf.line(x + w - len, y, x + w, y);
    pdf.line(x, y + h, x + len, y + h);
    pdf.line(x + w - len, y + h, x + w, y + h);
    pdf.line(x, y, x, y + len);
    pdf.line(x, y + h - len, x, y + h);
    pdf.line(x + w, y, x + w, y + len);
    pdf.line(x + w, y + h - len, x + w, y + h);
  } else {
    pdf.line(x, y, x + w, y);
    pdf.line(x, y + h, x + w, y + h);
    pdf.line(x, y, x, y + h);
    pdf.line(x + w, y, x + w, y + h);
  }
}

/* ---------------- DOCX export ---------------- */
testWordBtn.addEventListener("click", async () => {
  if (!window.docx) {
    alert("Không tải được docx.");
    return;
  }
  try {
    const { Document, Packer, Paragraph } = window.docx;
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph("Card Printer Pro – test DOCX"),
            new Paragraph("Nếu file này mở OK, bạn có thể Xuất DOCX đầy đủ."),
          ],
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "test-word.docx";
    a.click();
    lastDocxTestOK = true;
  } catch {
    lastDocxTestOK = false;
    alert("Tạo file test thất bại.");
  }
});

exportDocxBtn.addEventListener("click", async () => {
  if (cards.length === 0) return alert("Chưa có card nào.");
  if (!window.docx) return alert("Không tải được docx.");
  if (!lastDocxTestOK) {
    const ok = confirm("Bạn chưa chạy Test Word. Vẫn xuất chứ?");
    if (!ok) return;
  }

  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    WidthType,
    ImageRun,
  } = window.docx;
  const mmToEMU = (mm) => (mm / 25.4) * 914400;

  const margin = +marginInput.value;
  const gap = +gapInput.value;
  const bleed = +bleedInput.value;
  const orientation = orientationSelect.value;
  const fbMode = frontBackModeSelect.value;
  const flipMode = backFlipModeSelect.value;

  let cardWmm = +cardWInput.value + bleed * 2;
  let cardHmm = +cardHInput.value + bleed * 2;
  const cols = 3,
    rows = 3;

  const expanded = expandCards(cards);

  const toBuffer = toBufferForDocx;

  const allBuffers = await Promise.all(
    expanded.map((c) => toBuffer(c.src).catch(() => null))
  );
  let backBuffer = null;
  if (backImage) {
    try {
      backBuffer = await toBuffer(backImage);
    } catch {
      backBuffer = null;
    }
  }

  const missing =
    allBuffers.filter((b) => !b).length + (backImage && !backBuffer ? 1 : 0);
  if (missing > 0)
    alert(
      `${missing} ảnh không thể nhúng vào DOCX (CORS/định dạng). Hãy tải ảnh về rồi kéo file vào.`
    );

  const doc = new Document({ sections: [] });

  const makePage = (arr, isBack = false, startIdx = 0) => {
    const rowNodes = [];
    let bufIdx = startIdx;
    for (let r = 0; r < rows; r++) {
      const cellNodes = [];
      for (let c = 0; c < cols; c++) {
        const card = arr[bufIdx];
        let child = new Paragraph("");
        if (card) {
          const dataBuf =
            isBack && backBuffer ? backBuffer : allBuffers[bufIdx] || null;
          if (dataBuf) {
            const img = new ImageRun({
              data: dataBuf,
              transformation: {
                width: mmToEMU(cardWmm),
                height: mmToEMU(cardHmm),
              },
            });
            child = new Paragraph({ children: [img] });
          }
        }
        cellNodes.push(
          new TableCell({
            children: [child],
            width: { size: 100 / cols, type: WidthType.PERCENTAGE },
            margins: {
              top: mmToEMU(gap / 2),
              bottom: mmToEMU(gap / 2),
              left: mmToEMU(gap / 2),
              right: mmToEMU(gap / 2),
            },
          })
        );
        bufIdx++;
      }
      rowNodes.push(new TableRow({ children: cellNodes }));
    }
    const table = new Table({
      rows: rowNodes,
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
    doc.addSection({
      properties: {
        page: {
          size: {
            orientation: orientation === "landscape" ? "landscape" : "portrait",
          },
          margin: {
            top: mmToEMU(margin),
            bottom: mmToEMU(margin),
            left: mmToEMU(margin),
            right: mmToEMU(margin),
          },
        },
      },
      children: [table],
    });
  };

  if (fbMode === "front-only" || fbMode === "front-back") {
    for (let i = 0; i < expanded.length; i += 9)
      makePage(expanded.slice(i, i + 9), false, i);
  }
  if ((fbMode === "back-only" || fbMode === "front-back") && backImage) {
    const backs = maybeFlipOrder(expanded, flipMode, cols);
    for (let i = 0; i < backs.length; i += 9)
      makePage(backs.slice(i, i + 9), true, i);
  }

  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (fileNameInput.value || "cards") + ".docx";
  a.click();
});

/* ---------------- Deck manager ---------------- */
saveDeckBtn.addEventListener("click", async () => {
  const name = prompt(
    "Tên deck muốn lưu?",
    currentDeckName || fileNameInput.value || "deck-mới"
  );
  if (!name) return;
  await idbSaveDeck(name, { cards, backImage, settings: grabSettings() });
  currentDeckName = name;
  currentDeckNameEl.innerHTML = `🗂 Deck: <em>${name}</em>`;
  updateDeckBtn.disabled = false;
  alert("Đã lưu deck.");
});

manageDeckBtn.addEventListener("click", async () => {
  pageDragCounter = 0;
  pageDropOverlay.classList.remove("show");
  deckManager.classList.remove("hidden");
  await renderDeckListFromDB();
});
closeDeckManager.addEventListener("click", () =>
  deckManager.classList.add("hidden")
);

createDeckBtn.addEventListener("click", async () => {
  const name = newDeckName.value.trim();
  if (!name) return alert("Nhập tên deck.");
  await idbSaveDeck(name, { cards, backImage, settings: grabSettings() });
  newDeckName.value = "";
  currentDeckName = name;
  currentDeckNameEl.innerHTML = `🗂 Deck: <em>${name}</em>`;
  updateDeckBtn.disabled = false;
  await renderDeckListFromDB();
});

async function renderDeckListFromDB() {
  const decks = await idbGetAllDecks();
  deckList.innerHTML = "";
  if (!decks.length) {
    deckList.innerHTML = `<p style="color:#94a3b8;font-size:0.8rem;">Chưa có deck nào.</p>`;
    return;
  }
  decks.forEach((deck) => {
    const row = document.createElement("div");
    row.className = "deck-item";
    const time = deck.updatedAt
      ? new Date(deck.updatedAt).toLocaleString()
      : "";
    row.innerHTML = `
      <span>${deck.name}<span style="color:#94a3b8;font-size:0.65rem;display:block">${time}</span></span>
      <div class="deck-actions">
        <button data-load="${deck.name}">Tải</button>
        <button data-merge="${deck.name}">Cập nhật thêm</button>
        <button data-rename="${deck.name}">Đổi tên</button>
        <button data-del="${deck.name}">Xóa</button>
      </div>
    `;
    deckList.appendChild(row);
  });
}
deckList.addEventListener("click", async (e) => {
  const loadBtn = e.target.closest("[data-load]");
  const delBtn = e.target.closest("[data-del]");
  const renameBtn = e.target.closest("[data-rename]");
  const mergeBtn = e.target.closest("[data-merge]");

  if (loadBtn) {
    const name = loadBtn.dataset.load;
    const deck = await idbGetDeck(name);
    if (!deck) return alert("Không tìm thấy deck.");
    snapshot();
    cards = deck.cards || [];
    backImage = deck.backImage || null;
    applySettings(deck.settings || {});
    renderList();
    drawLayoutPreview();
    updateCounters();
    if (backImage) backInfo.textContent = "Đã chọn mặt sau (từ deck).";
    currentDeckName = name;
    currentDeckNameEl.innerHTML = `🗂 Deck: <em>${name}</em>`;
    updateDeckBtn.disabled = false;
    deckManager.classList.add("hidden");
    return;
  }
  if (delBtn) {
    const name = delBtn.dataset.del;
    if (!confirm(`Xóa deck "${name}"?`)) return;
    await idbDeleteDeck(name);
    if (currentDeckName === name) {
      currentDeckName = null;
      currentDeckNameEl.innerHTML = `🗂 Deck: <em>Chưa chọn</em>`;
      updateDeckBtn.disabled = true;
    }
    await renderDeckListFromDB();
    return;
  }
  if (renameBtn) {
    const oldName = renameBtn.dataset.rename;
    const newName = prompt("Tên mới cho deck:", oldName);
    if (!newName || newName === oldName) return;
    const all = await idbGetAllDecks();
    if (all.find((d) => d.name === newName)) {
      alert("Tên đã tồn tại.");
      return;
    }
    await idbRenameDeck(oldName, newName);
    if (currentDeckName === oldName) {
      currentDeckName = newName;
      currentDeckNameEl.innerHTML = `🗂 Deck: <em>${newName}</em>`;
    }
    await renderDeckListFromDB();
    return;
  }
  if (mergeBtn) {
    const name = mergeBtn.dataset.merge;
    const deck = await idbGetDeck(name);
    if (!deck) return alert("Không tìm thấy deck.");
    const existing = deck.cards || [];
    const existSet = new Set(existing.map((c) => c.src));
    const additions = cards.filter((c) => !existSet.has(c.src));
    if (additions.length === 0) {
      alert("Không có card mới để thêm.");
      return;
    }
    const merged = existing.concat(additions);
    await idbSaveDeck(name, {
      cards: merged,
      backImage: deck.backImage ?? backImage,
      settings: deck.settings || grabSettings(),
    });
    alert(`Đã thêm ${additions.length} card mới vào deck "${name}".`);
    await renderDeckListFromDB();
  }
});

updateDeckBtn.addEventListener("click", async () => {
  if (!currentDeckName) return alert("Chưa chọn deck nào.");
  await idbSaveDeck(currentDeckName, {
    cards,
    backImage,
    settings: grabSettings(),
  });
  alert(`✅ Đã cập nhật deck "${currentDeckName}".`);
});

/* ---------------- YDK export ---------------- */
exportYdkBtn?.addEventListener("click", () => {
  const withIds = cards.filter((card) => card.cardId);
  if (!withIds.length) {
    alert("Không có card .ydk nào để xuất. Hãy nhập deck .ydk trước.");
    return;
  }
  const lines = ["#created by Card Printer Pro", "#main"];
  withIds.forEach((card) => {
    const qty = Math.max(1, Number(card.qty) || 1);
    for (let i = 0; i < qty; i++) lines.push(card.cardId);
  });
  lines.push("#extra", "!side");
  const blob = new Blob([lines.join("\n")], {
    type: "text/plain",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (fileNameInput.value || "deck") + ".ydk";
  a.click();
});

/* ---------------- JSON import/export ---------------- */
exportJsonBtn.addEventListener("click", () => {
  const data = { cards, backImage, settings: grabSettings() };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (fileNameInput.value || "cards") + ".json";
  a.click();
});
importJsonBtn.addEventListener("click", () => importJsonInput.click());
importJsonInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    snapshot();
    const data = JSON.parse(evt.target.result);
    cards = data.cards || [];
    backImage = data.backImage || null;
    applySettings(data.settings || {});
    renderList();
    drawLayoutPreview();
    updateCounters();
  };
  reader.readAsText(f);
});

/* ---------------- Init ---------------- */
(async function init() {
  // preset init
  if (cardPreset && !isNaN(parseInt(cardPreset.value.split("x")[0]))) {
    const [w, h] = cardPreset.value.split("x").map(Number);
    cardWInput.value = w;
    cardHInput.value = h;
  }

  const last = loadLastSettings();
  if (last) applySettings(last);
  else enforceBackSettings();

  if (shortcutDeleteInput) normalizeShortcutInput(shortcutDeleteInput, "E");
  if (shortcutIncInput) normalizeShortcutInput(shortcutIncInput, "D");
  if (shortcutDecInput) normalizeShortcutInput(shortcutDecInput, "F");

  await migrateOldDecksIfAny();

  drawLayoutPreview();
  updateCounters();
  console.log("✅ app.js (FULL) loaded");
})();
