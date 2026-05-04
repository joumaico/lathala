/* =============================================================
   LATHALA — Feed App
   Architecture:
   - Cards use `position: absolute; inset: 0` → they fill .feed
   - ALL animation is done via transform only (translate3d + scale)
   - No top/left manipulation ever — transform-origin is center
   - applyStack() is the single source of truth for card state
============================================================= */

/* ── DATA ────────────────────────────────────────────────── */
const articles = [
  {
    image: "static/images/image-1.jpg",
    title: "Patients Face Predatory Medical Credit Card Practices",
    tag: "Business",
    url: "https://google.com",
    bullets: ["High-interest medical credit traps patients in long debt cycles.", "Hidden fees compound the burden well beyond the original bill.", "Many patients sign agreements without understanding full terms.", "Advocates push for stronger federal consumer protections now."],
    date: "May 2, 2026",
    publisher: { name: "Inquirer.net", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-2.jpg",
    title: "AI Reshapes the Future of Remote Work Globally",
    tag: "Technology",
    url: "https://google.com",
    bullets: ["Automation is steadily replacing routine office-based tasks.", "Collaboration tools now ship with built-in AI co-pilots.", "Companies are shrinking headquarters footprints worldwide.", "Workers in all sectors must reskill to remain competitive."],
    date: "May 1, 2026",
    publisher: { name: "Manila Bulletin", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-3.jpg",
    title: "Climate Crisis Pushes Pacific Islands to Relocate",
    tag: "Health",
    url: "https://google.com",
    bullets: ["Rising seas now threaten entire island communities daily.", "Governments have launched funded mass-relocation programs.", "Cultural identity is deeply at risk from forced displacement.", "International aid pledges still fall short of what is needed."],
    date: "Apr 30, 2026",
    publisher: { name: "GMA News", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-4.jpg",
    title: "Global Food Prices Hit Record High This Quarter",
    tag: "Business",
    url: "https://google.com",
    bullets: ["Supply chain disruptions are driving costs to record levels.", "Wheat and rice exports remain severely and dangerously disrupted.", "Low-income nations are bearing the heaviest financial toll.", "Emergency food reserves are depleted in at least 12 countries."],
    date: "Apr 29, 2026",
    publisher: { name: "Reuters", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-5.jpg",
    title: "Scientists Discover New Antibiotic After 30-Year Gap",
    tag: "Health",
    url: "https://google.com",
    bullets: ["The new compound specifically targets drug-resistant bacteria.", "It was derived from microorganisms found in deep-sea sediments.", "Researchers say it could combat superbugs threatening millions.", "Phase-one clinical trials are scheduled to begin next quarter."],
    date: "Apr 28, 2026",
    publisher: { name: "BBC News", logo: "static/images/logo.png" },
  },
];

/* ── CONSTANTS ───────────────────────────────────────────── */
const SWIPE_THRESHOLD = 72;
const RESISTANCE = 0.07;
const FLY_MS = 260;

/* ── STATE ───────────────────────────────────────────────── */
let activeIndex = 0;
let cards = [];
let rafId = null;
let activeTag = null;
const attached = new WeakSet();

/* ── HELPERS ─────────────────────────────────────────────── */
function getFilteredArticles() {
  return activeTag ? articles.filter((a) => a.tag === activeTag) : articles;
}

/* ── BOOT ────────────────────────────────────────────────── */
function init() {
  const feed = document.getElementById("feed");

  const bar = document.createElement("div");
  bar.className = "feed-progress";
  bar.innerHTML = `<div class="feed-progress__fill" id="progress-fill"></div>`;
  feed.appendChild(bar);

  getFilteredArticles().forEach((a, i) => {
    const el = buildCard(a, i);
    feed.appendChild(el);
    cards.push(el);
  });

  const hint = document.createElement("div");
  hint.className = "swipe-hint";
  hint.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
    SWIPE TO NEXT
  `;
  feed.appendChild(hint);

  applyStack(true);
  updateProgress();
  initSidebar();
}

/* ── REBUILD FEED (after filter) ─────────────────────────── */
function rebuildFeed() {
  const feed = document.getElementById("feed");
  cards.forEach((c) => c.remove());
  cards = [];
  activeIndex = 0;

  const filtered = getFilteredArticles();
  filtered.forEach((a, i) => {
    const el = buildCard(a, i);
    feed.appendChild(el);
    cards.push(el);
  });

  applyStack(true);
  updateProgress();
}

/* ── BUILD CARD ─────────────────────────────────────────── */
function buildCard(article, idx) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.idx = idx;

  const bulletCount = article.bullets.length;

  el.innerHTML = `
    <div class="card__image" style="background-image:url('${article.image}')">
      <div class="card__publisher">
        <div class="card__publisher-left">
          <div class="card__logo" style="background-image:url('${article.publisher.logo}')"></div>
          <div class="card__meta">
            <span class="card__pub-name">${article.publisher.name}</span>
            <span class="card__pub-date">${article.date}</span>
          </div>
        </div>
        <div class="card__tag">${article.tag}</div>
      </div>
    </div>

    <div class="card__content">
      <h2 class="card__title">${article.title}</h2>
      <div class="card__divider"></div>
      <div class="carousel">
        <div class="carousel__dot-track">
          ${article.bullets.map((_, i) => `<div class="carousel__dot-pip${i === 0 ? " active" : ""}"></div>`).join("")}
        </div>
        <div class="carousel__track">
          ${article.bullets
            .map(
              (b, i) => `
            <div class="carousel__item">
              <p class="carousel__text">${b}</p>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  initCarousel(el, bulletCount);
  return el;
}

/* ── CAROUSEL ────────────────────────────────────────────── */
function initCarousel(cardEl, total) {
  if (total <= 1) return;

  const track = cardEl.querySelector(".carousel__track");
  const pips = [...cardEl.querySelectorAll(".carousel__dot-pip")];
  let current = 0;

  function activatePip(newIdx) {
    if (newIdx === current) return;
    const oldPip = pips[current];
    const newPip = pips[newIdx];

    // Fluid tear animation: old pip shrinks/fades, new pip blooms
    oldPip.classList.remove("active");
    oldPip.classList.add("leaving");
    setTimeout(() => oldPip.classList.remove("leaving"), 1000);

    newPip.classList.add("arriving");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newPip.classList.add("active");
        setTimeout(() => newPip.classList.remove("arriving"), 100);
      });
    });

    current = newIdx;
  }

  track.addEventListener(
    "scroll",
    () => {
      const itemH = track.clientHeight;
      if (!itemH) return;
      const newIdx = Math.round(track.scrollTop / itemH);
      if (newIdx >= 0 && newIdx < total) {
        activatePip(newIdx);
      }
    },
    { passive: true },
  );
}

/* ── STACK ───────────────────────────────────────────────── */
function applyStack(instant = false) {
  cards.forEach((card, i) => {
    const offset = i - activeIndex;
    const noAnim = instant || offset < -1 || offset > 2;

    card.style.willChange = Math.abs(offset) <= 1 ? "transform, opacity" : "auto";

    if (!noAnim) {
      card.style.transition = "transform 0.32s cubic-bezier(.25,.46,.45,.94), opacity 0.32s ease";
    } else {
      card.style.transition = "none";
    }

    if (offset === 0) {
      setCardStyle(card, "translate3d(0,0,0) scale(1)", 1, 10, "auto");
    } else if (offset === 1) {
      setCardStyle(card, "translate3d(0,0,0) scale(0.91)", 0.5, 9, "none");
    } else if (offset === -1) {
      setCardStyle(card, "translate3d(0,0,0) scale(0.91)", 0, 8, "none");
    } else {
      setCardStyle(card, "translate3d(0,0,0) scale(0.86)", 0, 0, "none");
    }

    if (offset === 0) attachDrag(card);
  });
}

function setCardStyle(el, transform, opacity, zIndex, pointerEvents) {
  el.style.transform = transform;
  el.style.opacity = opacity;
  el.style.zIndex = zIndex;
  el.style.pointerEvents = pointerEvents;
}

/* ── DRAG ────────────────────────────────────────────────── */
function attachDrag(card) {
  if (attached.has(card)) return;
  attached.add(card);

  let startX = 0,
    startY = 0,
    dragX = 0,
    live = false;
  let gestureDir = null; // 'h' = horizontal swipe, 'v' = vertical scroll
  let nextCard = null,
    prevCard = null;

  const getAdjacent = () => {
    nextCard = cards[activeIndex + 1] ?? null;
    prevCard = cards[activeIndex - 1] ?? null;
  };

  card.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragX = 0;
      live = true;
      gestureDir = null;
      getAdjacent();

      card.style.transition = "none";
      if (nextCard) {
        nextCard.style.willChange = "transform, opacity";
        nextCard.style.transition = "none";
      }
      if (prevCard) {
        prevCard.style.willChange = "transform, opacity";
        prevCard.style.transition = "none";
      }
    },
    { passive: true },
  );

  card.addEventListener(
    "touchmove",
    (e) => {
      if (!live) return;

      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // Lock gesture direction on first meaningful movement
      if (!gestureDir && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        gestureDir = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
      }

      // Vertical — let carousel scroll handle it, don't move the card
      if (gestureDir !== "h") return;

      const raw = dx;
      const goLeft = raw < 0;
      const goRight = raw > 0;
      const canNext = activeIndex < cards.length - 1;
      const canPrev = activeIndex > 0;
      const deadEnd = (goLeft && !canNext) || (goRight && !canPrev);

      dragX = deadEnd ? raw * RESISTANCE : raw;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        card.style.transform = `translate3d(${dragX}px,0,0) scale(1)`;

        if (deadEnd) return;

        const progress = Math.min(Math.abs(dragX) / 140, 1);

        if (goLeft && nextCard && canNext) {
          const s = 0.91 + 0.09 * progress;
          const o = 0.5 + 0.5 * progress;
          nextCard.style.transform = `translate3d(0,0,0) scale(${s})`;
          nextCard.style.opacity = o;
        } else if (nextCard) {
          nextCard.style.opacity = "0";
          nextCard.style.transform = "translate3d(0,0,0) scale(0.91)";
        }

        if (goRight && prevCard && canPrev) {
          const s = 0.91 + 0.09 * progress;
          const o = progress;
          prevCard.style.transform = `translate3d(0,0,0) scale(${s})`;
          prevCard.style.opacity = o;
        } else if (prevCard) {
          prevCard.style.opacity = "0";
          prevCard.style.transform = "translate3d(0,0,0) scale(0.91)";
        }
      });
    },
    { passive: true },
  );

  card.addEventListener(
    "touchend",
    () => {
      if (!live) return;
      live = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // If gesture was vertical, just clean up — no swipe commit
      if (gestureDir !== "h") {
        gestureDir = null;
        return;
      }
      gestureDir = null;

      const canNext = activeIndex < cards.length - 1;
      const canPrev = activeIndex > 0;

      if (dragX < -SWIPE_THRESHOLD && canNext) flyOff(card, "next");
      else if (dragX > SWIPE_THRESHOLD && canPrev) flyOff(card, "prev");
      else springBack(card);
    },
    { passive: true },
  );
}

/* ── FLY OFF ─────────────────────────────────────────────── */
function flyOff(card, dir) {
  const exitX = dir === "next" ? "-112%" : "112%";

  card.style.transition = `transform ${FLY_MS}ms cubic-bezier(.55,0,1,.45), opacity ${FLY_MS * 0.8}ms ease`;
  card.style.transform = `translate3d(${exitX},0,0) scale(0.92)`;
  card.style.opacity = "0";
  card.style.pointerEvents = "none";

  activeIndex += dir === "next" ? 1 : -1;

  const newTop = cards[activeIndex];
  if (newTop) {
    newTop.style.transition = `transform ${FLY_MS}ms cubic-bezier(.25,.46,.45,.94), opacity ${FLY_MS}ms ease`;
    newTop.style.transform = "translate3d(0,0,0) scale(1)";
    newTop.style.opacity = "1";
    newTop.style.zIndex = "10";
    newTop.style.pointerEvents = "auto";
    attachDrag(newTop);
  }

  updateProgress();
  setTimeout(() => applyStack(), FLY_MS + 30);
}

/* ── SPRING BACK ─────────────────────────────────────────── */
function springBack(card) {
  card.style.transition = "transform 0.36s cubic-bezier(.25,.46,.45,.94)";
  card.style.transform = "translate3d(0,0,0) scale(1)";

  const next = cards[activeIndex + 1];
  const prev = cards[activeIndex - 1];

  if (next) {
    next.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    next.style.transform = "translate3d(0,0,0) scale(0.91)";
    next.style.opacity = "0.5";
  }
  if (prev) {
    prev.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    prev.style.transform = "translate3d(0,0,0) scale(0.91)";
    prev.style.opacity = "0";
  }
}

/* ── PROGRESS BAR ────────────────────────────────────────── */
function updateProgress() {
  const fill = document.getElementById("progress-fill");
  if (fill) {
    const total = cards.length;
    const pct = total > 0 ? ((activeIndex + 1) / total) * 100 : 0;
    fill.style.width = pct + "%";
  }
}

/* ── SIDEBAR ─────────────────────────────────────────────── */
const FIXED_CATEGORIES = ["Politics", "Business", "Technology", "Health", "Sports", "Entertainment"];

function initSidebar() {
  const container = document.getElementById("sidebar-tags");

  const allBtn = document.createElement("button");
  allBtn.className = "sidebar-tag-btn" + (activeTag === null ? " active" : "");
  allBtn.innerHTML = `<span>All</span><span class="sidebar-tag-count">${articles.length}</span>`;
  allBtn.dataset.tag = "";
  allBtn.addEventListener("click", () => filterByTag(null));
  container.appendChild(allBtn);

  FIXED_CATEGORIES.forEach((tag) => {
    const count = articles.filter((a) => a.tag === tag).length;
    const btn = document.createElement("button");
    btn.className = "sidebar-tag-btn" + (activeTag === tag ? " active" : "");
    btn.dataset.tag = tag;
    btn.innerHTML = `<span>${tag}</span><span class="sidebar-tag-count">${count}</span>`;
    btn.addEventListener("click", () => filterByTag(tag));
    container.appendChild(btn);
  });

  document.getElementById("hamburger-btn").addEventListener("click", openSidebar);
  document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("open");
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
}

function filterByTag(tag) {
  activeTag = tag;

  document.querySelectorAll(".sidebar-tag-btn").forEach((btn) => {
    const match = tag === null ? btn.dataset.tag === "" : btn.dataset.tag === tag;
    btn.classList.toggle("active", match);
  });

  rebuildFeed();
  closeSidebar();
}

/* ── GO ──────────────────────────────────────────────────── */
init();
