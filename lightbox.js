(() => {
  const MARGIN = 32;
  const NAV_SPACE = 64; // room beside the image for the prev/next buttons
  const STRIP_HEIGHT = 96; // room below the image for the thumbnail strip
  const MIN_SIZE = 48; // smaller images are icons (status dots, badges), not screenshots
  const IMAGE_HOST = /(user-attachments|private-user-images\.githubusercontent|camo\.githubusercontent|user-images\.githubusercontent|raw\.githubusercontent)/;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
  const ICONS = {
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };

  let active = null;

  function isIcon(img) {
    // A not-yet-loaded image renders at 0×0, so only trust its size once loaded.
    if (!img.complete || img.naturalWidth === 0) return false;
    const rendered = img.getBoundingClientRect();
    const renderedSmall = rendered.width < MIN_SIZE && rendered.height < MIN_SIZE;
    const naturalSmall = img.naturalWidth < MIN_SIZE && img.naturalHeight < MIN_SIZE;
    return renderedSmall || naturalSmall;
  }

  function isZoomable(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.closest(".markdown-body, .comment-body")) return false;
    if (img.classList.contains("emoji") || img.classList.contains("avatar")) return false;
    if (isIcon(img)) return false;
    const link = img.closest("a");
    if (!link) return true;
    if (link.textContent.trim() !== "") return false;
    const href = link.href;
    return href === img.src || href === img.dataset.canonicalSrc || IMAGE_HOST.test(href) || IMAGE_EXT.test(href);
  }

  function galleryFor(clicked) {
    const images = [...document.querySelectorAll(".markdown-body img, .comment-body img")].filter(
      (img) => img === clicked || (isZoomable(img) && img.getClientRects().length > 0),
    );
    return images.includes(clicked) ? images : [clicked];
  }

  const srcOf = (img) => img.currentSrc || img.src;

  function naturalSize(img) {
    if (img.complete && img.naturalWidth) return Promise.resolve({ w: img.naturalWidth, h: img.naturalHeight });
    return new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => resolve({ w: 800, h: 600 });
      probe.src = srcOf(img);
    });
  }

  function fitRect({ w, h }, isGallery) {
    const sideSpace = isGallery ? NAV_SPACE : 0;
    const areaW = window.innerWidth - (MARGIN + sideSpace) * 2;
    const areaH = window.innerHeight - MARGIN * 2 - (isGallery ? STRIP_HEIGHT : 0);
    const scale = Math.min(1, areaW / w, areaH / h);
    const width = w * scale;
    const height = h * scale;
    return { left: (window.innerWidth - width) / 2, top: MARGIN + (areaH - height) / 2, width, height };
  }

  function place(el, rect) {
    Object.assign(el.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  const transformTo = (from, to) =>
    `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;

  function isInViewport(rect) {
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
  }

  function button(className, icon, label, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `ght-btn ${className}`;
    el.setAttribute("aria-label", label);
    el.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
    el.addEventListener("click", onClick);
    return el;
  }

  function buildChrome(images) {
    const chrome = document.createElement("div");
    chrome.className = "ght-chrome";
    chrome.append(button("ght-close", "close", "Close", close));
    if (images.length < 2) return { chrome, thumbs: [] };

    const counter = document.createElement("div");
    counter.className = "ght-counter";
    const prev = button("ght-prev", "prev", "Previous image", () => go(-1));
    const next = button("ght-next", "next", "Next image", () => go(1));

    const strip = document.createElement("div");
    strip.className = "ght-strip";
    const thumbs = images.map((img, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "ght-thumb";
      thumb.setAttribute("aria-label", `Image ${index + 1}`);
      const preview = document.createElement("img");
      preview.src = srcOf(img);
      preview.alt = "";
      preview.decoding = "async";
      thumb.append(preview);
      thumb.addEventListener("click", () => show(index));
      return thumb;
    });
    strip.append(...thumbs);
    strip.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        strip.scrollLeft += event.deltaY;
        event.preventDefault();
      },
      { passive: false },
    );

    chrome.append(counter, prev, next, strip);
    return { chrome, thumbs, counter, prev, next };
  }

  function open(img) {
    const images = galleryFor(img);
    const overlay = document.createElement("div");
    overlay.className = "ght-overlay";
    const parts = buildChrome(images);
    document.body.append(overlay, parts.chrome);
    document.documentElement.classList.add("ght-locked");

    active = { ...parts, images, overlay, index: -1, clone: null, size: null, token: 0 };
    show(images.indexOf(img), img.getBoundingClientRect());

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add("ght-open");
        parts.chrome.classList.add("ght-open");
      });
    });
  }

  function updateChrome(session, instant) {
    const { index, images, thumbs, counter, prev, next } = session;
    if (!counter) return;
    counter.textContent = `${index + 1} / ${images.length}`;
    prev.disabled = index === 0;
    next.disabled = index === images.length - 1;
    thumbs.forEach((thumb, i) => thumb.classList.toggle("ght-current", i === index));
    thumbs[index].scrollIntoView({ inline: "center", block: "nearest", behavior: instant ? "instant" : "smooth" });
  }

  async function show(index, fromRect) {
    const session = active;
    if (!session || index === session.index) return;
    session.images[session.index]?.classList.remove("ght-hidden");
    const img = session.images[index];
    img.classList.add("ght-hidden");
    session.index = index;
    updateChrome(session, Boolean(fromRect));

    const token = ++session.token;
    const size = await naturalSize(img);
    if (active !== session || session.token !== token) return;

    const clone = document.createElement("img");
    clone.className = "ght-image";
    clone.src = srcOf(img);
    clone.alt = img.alt;
    const rect = fitRect(size, session.images.length > 1);
    place(clone, rect);
    if (fromRect) {
      clone.style.transition = "none";
      clone.style.transform = transformTo(fromRect, rect);
    } else {
      clone.style.opacity = "0";
    }
    document.body.append(clone);
    clone.getBoundingClientRect();
    clone.style.transition = "";
    clone.style.transform = "none";
    clone.style.opacity = "1";

    const previous = session.clone;
    if (previous) {
      previous.style.opacity = "0";
      setTimeout(() => previous.remove(), 300);
    }
    Object.assign(session, { clone, size, rect });
  }

  function go(delta) {
    if (!active) return;
    const index = Math.min(Math.max(active.index + delta, 0), active.images.length - 1);
    show(index);
  }

  function close() {
    const session = active;
    if (!session) return;
    active = null;
    const { images, index, overlay, chrome, clone, rect } = session;
    const img = images[index];

    document.documentElement.classList.remove("ght-locked");
    if (!isInViewport(img.getBoundingClientRect())) img.scrollIntoView({ block: "center", behavior: "instant" });
    const target = img.getBoundingClientRect();

    if (clone && rect && target.width > 0) {
      clone.style.transform = transformTo(target, rect);
    } else if (clone) {
      clone.style.opacity = "0";
    }
    overlay.classList.remove("ght-open");
    chrome.classList.remove("ght-open");

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      img.classList.remove("ght-hidden");
      overlay.remove();
      chrome.remove();
      clone?.remove();
    };
    clone?.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 400);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (active) {
        if (event.target instanceof Element && event.target.closest(".ght-btn, .ght-thumb, .ght-strip")) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!isZoomable(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      open(event.target);
    },
    true,
  );

  // Capture on window so GitHub's own hotkeys don't fire behind the gallery.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!active || event.metaKey || event.ctrlKey || event.altKey) return;
      const actions = {
        Escape: close,
        ArrowLeft: () => go(-1),
        ArrowRight: () => go(1),
        Home: () => show(0),
        End: () => show(active.images.length - 1),
      };
      event.stopPropagation();
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    },
    true,
  );

  window.addEventListener("resize", () => {
    if (!active?.clone || !active.size) return;
    active.rect = fitRect(active.size, active.images.length > 1);
    place(active.clone, active.rect);
  });
  document.addEventListener("turbo:before-visit", close);
})();
