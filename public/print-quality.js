/* =============================================================
  High quality print export override
  - Runs after app.js and intercepts PDF/DOCX export buttons.
  - Keeps the existing card state/layout, but resolves the best image source
    and renders PDF images at print DPI before embedding.
  ============================================================= */
(function () {
  const PRINT_DPI = 600;
  const MAX_LONG_EDGE_PX = 3200;
  const PDF_JPEG_QUALITY = 0.98;
  const assetCache = new Map();

  function getEl(id) {
    return document.getElementById(id);
  }

  function getAppCards() {
    try {
      return Array.isArray(cards) ? cards : [];
    } catch {
      return [];
    }
  }

  function getBackImage() {
    try {
      return backImage || null;
    } catch {
      return null;
    }
  }

  function mmToPx(mm, dpi = PRINT_DPI) {
    return Math.max(1, Math.round((Number(mm) || 1) / 25.4 * dpi));
  }

  function mmToEMU(mm) {
    return ((Number(mm) || 0) / 25.4) * 914400;
  }

  function clampCanvasSize(width, height) {
    const longEdge = Math.max(width, height);
    if (longEdge <= MAX_LONG_EDGE_PX) return { width, height };
    const scale = MAX_LONG_EDGE_PX / longEdge;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function unique(list) {
    return [...new Set((list || []).filter(Boolean))];
  }

  function isDataUrl(value) {
    return /^data:image\//i.test(String(value || ""));
  }

  function buildHighResVariants(url) {
    const raw = String(url || "").trim();
    if (!raw || isDataUrl(raw) || !/^https?:\/\//i.test(raw)) return raw ? [raw] : [];

    const variants = [];
    try {
      const parsed = new URL(raw);
      const clean = new URL(parsed.href);
      [
        "w",
        "h",
        "width",
        "height",
        "size",
        "thumb",
        "thumbnail",
        "preview",
        "resize",
        "quality",
      ].forEach((key) => clean.searchParams.delete(key));
      variants.push(clean.href);

      const hi = new URL(clean.href);
      hi.searchParams.set("width", "1800");
      hi.searchParams.set("quality", "100");
      variants.push(hi.href);

      const pathVariants = [
        clean.pathname.replace(/\/(thumb|thumbnail|small|preview|low|middle|medium)\//gi, "/"),
        clean.pathname.replace(/([_-])(thumb|thumbnail|small|preview|low|medium)(?=\.)/gi, ""),
        clean.pathname.replace(/(cardlist|card_list|card-thumb|card_thumb)/gi, "card"),
      ];
      for (const pathname of pathVariants) {
        if (pathname && pathname !== clean.pathname) {
          const copy = new URL(clean.href);
          copy.pathname = pathname;
          variants.push(copy.href);
        }
      }
    } catch {}

    variants.push(raw);
    return unique(variants);
  }

  function sourceCandidates(cardOrSource) {
    if (typeof cardOrSource === "string") return buildHighResVariants(cardOrSource);

    const card = cardOrSource || {};
    const base = [
      card.printSrc,
      card.originalSrc,
      card.highResSrc,
      ...(Array.isArray(card.imageCandidates) ? card.imageCandidates : []),
      card.src,
    ];
    return unique(base.flatMap(buildHighResVariants));
  }

  async function blobFromUrl(url) {
    if (isDataUrl(url)) {
      const res = await fetch(url);
      return await res.blob();
    }
    if (typeof fetchBlobWithFallback === "function") {
      return await fetchBlobWithFallback(url);
    }
    const res = await fetch(url, { mode: "cors", redirect: "follow" });
    if (!res.ok) throw new Error(`Không tải được ảnh ${res.status}`);
    return await res.blob();
  }

  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      };
      img.src = url;
    });
  }

  async function resolveBestAsset(cardOrSource) {
    const candidates = sourceCandidates(cardOrSource);
    const cacheKey = candidates.join("|");
    if (assetCache.has(cacheKey)) return assetCache.get(cacheKey);

    const promise = (async () => {
      let best = null;
      let lastError = null;
      for (const url of candidates) {
        try {
          const blob = await blobFromUrl(url);
          if (!blob || blob.size === 0) continue;
          const img = await imageFromBlob(blob);
          const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
          if (!best || area > best.area) best = { url, blob, img, area };
        } catch (error) {
          lastError = error;
        }
      }
      if (!best) throw lastError || new Error("Không tải được ảnh chất lượng cao.");
      return best;
    })();

    assetCache.set(cacheKey, promise);
    return promise;
  }

  async function renderPdfDataUrl(cardOrSource, cardWmm, cardHmm) {
    const asset = await resolveBestAsset(cardOrSource);
    const target = clampCanvasSize(mmToPx(cardWmm), mmToPx(cardHmm));
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(asset.img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
  }

  async function bufferForDocx(cardOrSource) {
    const asset = await resolveBestAsset(cardOrSource);
    return await asset.blob.arrayBuffer();
  }

  function expandByQty(list) {
    const out = [];
    list.forEach((card) => {
      const amount = Math.max(1, Number(card.qty) || 1);
      for (let i = 0; i < amount; i++) out.push(card);
    });
    return out;
  }

  function flipOrderForBack(arr, mode, cols = 3) {
    if (mode === "none") return arr.slice();
    const result = [];
    for (let i = 0; i < arr.length; i += 9) {
      const page = arr.slice(i, i + 9);
      if (mode === "short") {
        for (let r = 0; r < 3; r++) result.push(...page.slice(r * cols, r * cols + cols).reverse());
      } else if (mode === "long") {
        result.push(...page.reverse());
      }
    }
    return result;
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
    } else if (mode === "full") {
      pdf.line(x, y, x + w, y);
      pdf.line(x, y + h, x + w, y + h);
      pdf.line(x, y, x, y + h);
      pdf.line(x + w, y, x + w, y + h);
    }
  }

  function readPrintLayout(pdf) {
    const margin = Number(getEl("margin")?.value) || 0;
    const gap = Number(getEl("gap")?.value) || 0;
    const bleed = Number(getEl("bleed")?.value) || 0;
    const autoFit = getEl("autoFit")?.value === "on";
    let cardWmm = (Number(getEl("cardW")?.value) || 59) + bleed * 2;
    let cardHmm = (Number(getEl("cardH")?.value) || 86) + bleed * 2;
    const cols = 3;
    const rows = 3;
    if (autoFit) {
      const needW = margin * 2 + cols * cardWmm + (cols - 1) * gap;
      const needH = margin * 2 + rows * cardHmm + (rows - 1) * gap;
      const scale = Math.min(pdf.internal.pageSize.getWidth() / needW, pdf.internal.pageSize.getHeight() / needH, 1);
      cardWmm *= scale;
      cardHmm *= scale;
    }
    return {
      margin,
      gap,
      cardWmm,
      cardHmm,
      cols,
      rows,
      cropMode: getEl("cropMarks")?.value || "none",
    };
  }

  async function renderCardsForPdf(cardsToRender, cardWmm, cardHmm) {
    const out = [];
    for (let i = 0; i < cardsToRender.length; i++) {
      try {
        out.push(await renderPdfDataUrl(cardsToRender[i], cardWmm, cardHmm));
      } catch (error) {
        console.warn("Không render được ảnh chất lượng cao:", cardsToRender[i]?.name || cardsToRender[i]?.src, error);
        out.push(null);
      }
    }
    return out;
  }

  async function printSide(pdf, imageData, opts) {
    const { margin, gap, cardWmm, cardHmm, cols, rows, cropMode } = opts;
    const perPage = cols * rows;
    let x = margin;
    let y = margin;
    let count = 0;

    for (let i = 0; i < imageData.length; i++) {
      const src = imageData[i];
      if (src) {
        try {
          pdf.addImage(src, "JPEG", x, y, cardWmm, cardHmm, undefined, "NONE");
        } catch (error) {
          console.warn("Không nhúng được ảnh PDF:", error);
        }
      }
      if (cropMode !== "none") drawCrop(pdf, x, y, cardWmm, cardHmm, cropMode);

      count += 1;
      x += cardWmm + gap;
      if (count % cols === 0) {
        x = margin;
        y += cardHmm + gap;
      }
      if (count === perPage && i < imageData.length - 1) {
        pdf.addPage();
        x = margin;
        y = margin;
        count = 0;
      }
    }
  }

  async function handleHighQualityPdf(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const list = getAppCards();
    if (!window.jspdf) return alert("Chưa nạp jsPDF.");
    if (!list.length) return alert("Chưa có card nào.");

    const button = getEl("exportPdf");
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Đang xuất PDF nét...";
    }

    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: getEl("orientation")?.value || "portrait",
        unit: "mm",
        format: getEl("pageSize")?.value === "letter" ? "letter" : "a4",
        compress: false,
        precision: 12,
      });
      const opts = readPrintLayout(pdf);
      const expanded = expandByQty(list);
      const mode = getEl("frontBackMode")?.value || "front-only";
      const frontImages = await renderCardsForPdf(expanded, opts.cardWmm, opts.cardHmm);

      let backImageData = null;
      const currentBack = getBackImage();
      if (currentBack && (mode === "back-only" || mode === "front-back")) {
        try {
          backImageData = await renderPdfDataUrl(currentBack, opts.cardWmm, opts.cardHmm);
        } catch (error) {
          console.warn("Không render được ảnh mặt sau:", error);
        }
      }

      const missing = frontImages.filter((value) => !value).length + (currentBack && !backImageData ? 1 : 0);
      if (missing > 0) alert(`${missing} ảnh không thể nhúng ở chất lượng cao. File vẫn được tạo với các ảnh còn lại.`);

      if (mode === "front-only") {
        await printSide(pdf, frontImages, opts);
      } else if (mode === "back-only") {
        if (!backImageData) return alert("Chưa render được ảnh mặt sau.");
        await printSide(pdf, frontImages.map(() => backImageData), opts);
      } else {
        await printSide(pdf, frontImages, opts);
        if (backImageData) {
          pdf.addPage();
          const backOrder = flipOrderForBack(frontImages, getEl("backFlipMode")?.value || "none", opts.cols).map(() => backImageData);
          await printSide(pdf, backOrder, opts);
        }
      }

      pdf.save((getEl("fileName")?.value || "cards") + ".pdf");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function handleHighQualityDocx(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const list = getAppCards();
    if (!list.length) return alert("Chưa có card nào.");
    if (!window.docx) return alert("Không tải được docx.");

    const button = getEl("exportDocx");
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Đang xuất DOCX nét...";
    }

    try {
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

      const margin = Number(getEl("margin")?.value) || 0;
      const gap = Number(getEl("gap")?.value) || 0;
      const bleed = Number(getEl("bleed")?.value) || 0;
      const orientation = getEl("orientation")?.value || "portrait";
      const mode = getEl("frontBackMode")?.value || "front-only";
      const flipMode = getEl("backFlipMode")?.value || "none";
      const cardWmm = (Number(getEl("cardW")?.value) || 59) + bleed * 2;
      const cardHmm = (Number(getEl("cardH")?.value) || 86) + bleed * 2;
      const cols = 3;
      const rows = 3;
      const expanded = expandByQty(list);

      const buffers = [];
      for (const card of expanded) {
        try {
          buffers.push(await bufferForDocx(card));
        } catch (error) {
          console.warn("Không lấy được buffer ảnh DOCX:", card?.name || card?.src, error);
          buffers.push(null);
        }
      }

      let backBuffer = null;
      const currentBack = getBackImage();
      if (currentBack) {
        try {
          backBuffer = await bufferForDocx(currentBack);
        } catch (error) {
          console.warn("Không lấy được buffer mặt sau:", error);
        }
      }

      const doc = new Document({ sections: [] });
      const makePage = (cardsOnPage, isBack = false, startIdx = 0) => {
        const rowNodes = [];
        let idx = startIdx;
        for (let r = 0; r < rows; r++) {
          const cellNodes = [];
          for (let c = 0; c < cols; c++) {
            const card = cardsOnPage[idx - startIdx];
            let child = new Paragraph("");
            if (card) {
              const data = isBack && backBuffer ? backBuffer : buffers[idx] || null;
              if (data) {
                child = new Paragraph({
                  children: [
                    new ImageRun({
                      data,
                      transformation: {
                        width: mmToEMU(cardWmm),
                        height: mmToEMU(cardHmm),
                      },
                    }),
                  ],
                });
              }
            }
            cellNodes.push(new TableCell({
              children: [child],
              width: { size: 100 / cols, type: WidthType.PERCENTAGE },
              margins: {
                top: mmToEMU(gap / 2),
                bottom: mmToEMU(gap / 2),
                left: mmToEMU(gap / 2),
                right: mmToEMU(gap / 2),
              },
            }));
            idx += 1;
          }
          rowNodes.push(new TableRow({ children: cellNodes }));
        }

        doc.addSection({
          properties: {
            page: {
              size: { orientation: orientation === "landscape" ? "landscape" : "portrait" },
              margin: {
                top: mmToEMU(margin),
                bottom: mmToEMU(margin),
                left: mmToEMU(margin),
                right: mmToEMU(margin),
              },
            },
          },
          children: [new Table({ rows: rowNodes, width: { size: 100, type: WidthType.PERCENTAGE } })],
        });
      };

      if (mode === "front-only" || mode === "front-back") {
        for (let i = 0; i < expanded.length; i += 9) makePage(expanded.slice(i, i + 9), false, i);
      }
      if ((mode === "back-only" || mode === "front-back") && currentBack) {
        const backs = flipOrderForBack(expanded, flipMode, cols);
        for (let i = 0; i < backs.length; i += 9) makePage(backs.slice(i, i + 9), true, i);
      }

      const blob = await Packer.toBlob(doc);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = (getEl("fileName")?.value || "cards") + ".docx";
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  function installHighQualityExport() {
    getEl("exportPdf")?.addEventListener("click", handleHighQualityPdf, true);
    getEl("exportDocx")?.addEventListener("click", handleHighQualityDocx, true);
    console.log("✅ High quality print export loaded");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installHighQualityExport);
  else installHighQualityExport();
})();
