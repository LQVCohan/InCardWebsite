/* =============================================================
  GSAP interface motion for Card Printer Pro
  - Progressive enhancement: app works normally if GSAP is missing
  - Respects prefers-reduced-motion
  - Keeps animation separate from import/export business logic
  ============================================================= */
(function () {
  const ready = (fn) => {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  };

  ready(() => {
    const gsap = window.gsap;
    if (!gsap) {
      console.info("GSAP chưa tải được, bỏ qua motion UI.");
      return;
    }

    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.defaults({ duration: 0.42, ease: "power3.out", overwrite: "auto" });

      const cardList = document.getElementById("previewList");
      const deckManager = document.getElementById("deckManager");
      const imageViewer = document.getElementById("imageViewer");
      const pageDropOverlay = document.getElementById("pageDropOverlay");
      const dropzone = document.getElementById("dropzone");

      let lastCardCount = cardList?.children.length || 0;
      const observers = [];
      const cleanups = [];

      const runIntro = () => {
        const introTargets = [
          ".topbar",
          "#dropzone",
          "#decklogPanel",
          "#backSection:not([style*='display:none'])",
          ".controls",
          ".actions",
          ".stats",
          ".preview-section",
          ".empty-state",
        ].join(", ");

        gsap.set(introTargets, { willChange: "transform, opacity" });
        gsap
          .timeline({ defaults: { duration: 0.5, ease: "power3.out" } })
          .from(".topbar", { autoAlpha: 0, y: -14 })
          .from(
            "#dropzone, #decklogPanel, #backSection:not([style*='display:none']), .controls, .actions, .stats, .preview-section, .empty-state",
            { autoAlpha: 0, y: 18, scale: 0.985, stagger: 0.055, clearProps: "transform,opacity,visibility,willChange" },
            "<0.08"
          );
      };

      const pulse = (target, options = {}) => {
        if (!target) return;
        gsap.fromTo(
          target,
          { scale: options.fromScale || 0.985 },
          {
            scale: 1,
            duration: options.duration || 0.28,
            ease: options.ease || "back.out(1.8)",
            clearProps: "transform",
          }
        );
      };

      const animateAddedCards = (nodes) => {
        const cards = nodes.filter((node) => node.nodeType === 1 && node.matches?.(".preview-item"));
        if (!cards.length) return;
        gsap.set(cards, { willChange: "transform, opacity" });
        gsap.from(cards, {
          autoAlpha: 0,
          y: 18,
          scale: 0.96,
          duration: 0.36,
          stagger: { each: 0.035, from: "start" },
          clearProps: "transform,opacity,visibility,willChange",
        });
      };

      if (cardList) {
        const cardObserver = new MutationObserver((mutations) => {
          requestAnimationFrame(() => {
            const currentCount = cardList.children.length;
            const addedNodes = mutations.flatMap((mutation) => Array.from(mutation.addedNodes));
            if (currentCount > lastCardCount || lastCardCount === 0) animateAddedCards(addedNodes);
            lastCardCount = currentCount;
          });
        });
        cardObserver.observe(cardList, { childList: true });
        observers.push(cardObserver);
      }

      const animateVisibleModal = (modal, contentSelector) => {
        if (!modal || modal.classList.contains("hidden")) return;
        const content = modal.querySelector(contentSelector);
        gsap.fromTo(modal, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
        if (content) {
          gsap.fromTo(
            content,
            { autoAlpha: 0, y: 16, scale: 0.97 },
            { autoAlpha: 1, y: 0, scale: 1, duration: 0.34, ease: "power3.out", clearProps: "transform,opacity,visibility" }
          );
        }
      };

      [
        [deckManager, ".modal-content"],
        [imageViewer, ".viewer-content, .modal-content"],
      ].forEach(([modal, contentSelector]) => {
        if (!modal) return;
        const observer = new MutationObserver(() => animateVisibleModal(modal, contentSelector));
        observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
        observers.push(observer);
      });

      if (pageDropOverlay) {
        const overlayObserver = new MutationObserver(() => {
          if (pageDropOverlay.classList.contains("show")) {
            const box = pageDropOverlay.querySelector(".overlay-content, .page-drop-box");
            gsap.fromTo(pageDropOverlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18 });
            if (box) pulse(box, { fromScale: 0.94, duration: 0.36 });
          }
        });
        overlayObserver.observe(pageDropOverlay, { attributes: true, attributeFilter: ["class"] });
        observers.push(overlayObserver);
      }

      if (dropzone) {
        const dropObserver = new MutationObserver(() => {
          if (dropzone.classList.contains("dragover")) {
            gsap.to(dropzone, { scale: 1.01, duration: 0.18, ease: "power2.out" });
          } else {
            gsap.to(dropzone, { scale: 1, duration: 0.22, clearProps: "transform" });
          }
        });
        dropObserver.observe(dropzone, { attributes: true, attributeFilter: ["class"] });
        observers.push(dropObserver);
      }

      const bindPressFeedback = () => {
        const onPointerDown = (event) => {
          const button = event.target.closest?.(".btn, .qty-btn, .deck-actions button, .close-viewer");
          if (!button || button.disabled) return;
          gsap.to(button, { scale: 0.97, duration: 0.08, ease: "power2.out" });
        };
        const onPointerUp = (event) => {
          const button = event.target.closest?.(".btn, .qty-btn, .deck-actions button, .close-viewer");
          if (!button || button.disabled) return;
          gsap.to(button, { scale: 1, duration: 0.16, ease: "back.out(2)", clearProps: "transform" });
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
        cleanups.push(() => {
          document.removeEventListener("pointerdown", onPointerDown);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("pointercancel", onPointerUp);
        });
      };

      const bindDeckLogFeedback = () => {
        const buttons = ["decklogImportBtn", "decklogZipBtn"]
          .map((id) => document.getElementById(id))
          .filter(Boolean);
        const onClick = () => pulse(document.getElementById("decklogPanel"));
        buttons.forEach((button) => button.addEventListener("click", onClick));
        cleanups.push(() => buttons.forEach((button) => button.removeEventListener("click", onClick)));
      };

      runIntro();
      bindPressFeedback();
      bindDeckLogFeedback();

      return () => {
        observers.forEach((observer) => observer.disconnect());
        cleanups.forEach((cleanup) => cleanup());
      };
    });
  });
})();
