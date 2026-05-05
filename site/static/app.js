/* ── SUPABASE CONFIG ───────────────────────────────────────
   Use your public anon key here. Do NOT put your service role key
   in frontend code.
──────────────────────────────────────────────────────────── */
const SUPABASE_URL = "https://ruludjzcqacclehqkppk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9ZW1kHjsWy4vkHIYvEd6Mg_vG_hpFnc";
const ARTICLE_LIMIT = 1000;
const DEFAULT_IMAGE = "static/images/default.png";
const DEFAULT_PUBLISHER_LOGO = "static/images/logo.png";
const FIXED_CATEGORIES = ["Politics", "Business", "Technology", "Health", "Sports", "Entertainment"];

/* ── FALLBACK DATA ─────────────────────────────────────────
   This keeps the app usable while the Supabase anon key is not set.
──────────────────────────────────────────────────────────── */
const FALLBACK_ARTICLES = [
  {
    image: "static/images/image-1.jpg",
    title: "Patients Face Predatory Medical Credit Card Practices",
    tag: "Business",
    url: "https://google.com",
    bullets: ["High-interest medical credit traps patients in long debt cycles.", "Hidden fees compound the burden well beyond the original bill.", "Many patients sign agreements without understanding full terms.", "Advocates push for stronger federal consumer protections now."],
    date: "2026-05-02",
    publisher: { name: "Inquirer.net", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-2.jpg",
    title: "AI Reshapes the Future of Remote Work Globally",
    tag: "Technology",
    url: "https://google.com",
    bullets: ["Automation is steadily replacing routine office-based tasks.", "Collaboration tools now ship with built-in AI co-pilots.", "Companies are shrinking headquarters footprints worldwide.", "Workers in all sectors must reskill to remain competitive."],
    date: "2026-05-01",
    publisher: { name: "Manila Bulletin", logo: "static/images/logo.png" },
  },
  {
    image: "static/images/image-3.jpg",
    title: "Climate Crisis Pushes Pacific Islands to Relocate",
    tag: "Health",
    url: "https://google.com",
    bullets: ["Rising seas now threaten entire island communities daily.", "Governments have launched funded mass-relocation programs.", "Cultural identity is deeply at risk from forced displacement.", "International aid pledges still fall short of what is needed."],
    date: "2026-04-30",
    publisher: { name: "GMA News", logo: "static/images/logo.png" },
  },
];

/* ── CONSTANTS ───────────────────────────────────────────── */
const SWIPE_THRESHOLD = 72;
const RESISTANCE = 0.07;
const FLY_MS = 260;

/* ── STATE ───────────────────────────────────────────────── */
let allArticles = [];
let articles = [];
let activeIndex = 0;
let cards = [];
let rafId = null;
let activeTag = null;
let isLoading = false;
let loadError = null;
const attached = new WeakSet();

/* ── HELPERS ─────────────────────────────────────────────── */
function hasSupabaseKey() {
  return SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("PASTE_YOUR_SUPABASE_ANON_KEY_HERE");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value, fallback = "") {
  if (!value) return fallback;

  try {
    const url = new URL(String(value), window.location.href);
    if (["http:", "https:"].includes(url.protocol)) return url.href;
  } catch (_) {
    // Fall through to relative URL handling below.
  }

  const text = String(value);
  if (text.startsWith("static/") || text.startsWith("./") || text.startsWith("/")) return text;
  return fallback;
}

function getPublisherName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "Lathala";
  }
}

function formatDateForDisplay(value) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeRpcRow(row) {
  if (row && typeof row === "object" && "get_articles_by_tag" in row) {
    return row.get_articles_by_tag;
  }
  return row;
}

function normalizeArticle(row) {
  const item = normalizeRpcRow(row) ?? {};
  const url = safeUrl(item.url, "#");
  const publisher = item.publisher && typeof item.publisher === "object" ? item.publisher : {};
  const bullets = Array.isArray(item.bullets) ? item.bullets.map((b) => String(b)).filter(Boolean) : [];

  return {
    url,
    tag: String(item.tag || "Uncategorized"),
    date: String(item.date || ""),
    image: safeUrl(item.image, DEFAULT_IMAGE),
    title: String(item.title || "Untitled Article"),
    bullets: bullets.length ? bullets : ["No summary bullets are available for this article yet."],
    publisher: {
      id: publisher.id ?? item.publisher_id ?? null,
      name: String(publisher.name || item.publisher_name || getPublisherName(url)),
      url: safeUrl(publisher.url || item.publisher_url, "#"),
      logo: safeUrl(publisher.logo || item.publisher_logo, DEFAULT_PUBLISHER_LOGO),
    },
  };
}

function normalizeArticles(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeArticle).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function getCountForTag(tag) {
  return allArticles.filter((a) => a.tag === tag).length;
}

async function fetchArticlesByTag(tag) {
  if (!hasSupabaseKey()) {
    console.warn("Supabase anon key is not set. Using fallback articles.");
    const fallback = normalizeArticles(FALLBACK_ARTICLES);
    return tag ? fallback.filter((a) => a.tag === tag) : fallback;
  }

  const params = new URLSearchParams({
    p_limit: String(ARTICLE_LIMIT),
  });

  // No tag means fetch all articles from all tags.
  if (tag && String(tag).trim()) {
    params.set("tag", tag);
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_articles_by_tag?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${message}`);
  }

  return normalizeArticles(await response.json());
}

async function loadArticles(tag = null) {
  isLoading = true;
  loadError = null;
  renderFeedState("Loading articles…");
  updateSidebarDisabledState(true);

  try {
    const loaded = await fetchArticlesByTag(tag);
    articles = loaded;

    if (tag === null) {
      allArticles = loaded;
    } else if (!allArticles.length) {
      allArticles = normalizeArticles(FALLBACK_ARTICLES);
    }
  } catch (error) {
    console.error(error);
    loadError = error.message;

    if (!allArticles.length) {
      allArticles = normalizeArticles(FALLBACK_ARTICLES);
    }

    articles = tag ? allArticles.filter((a) => a.tag === tag) : allArticles;
  } finally {
    isLoading = false;
    rebuildFeed();
    renderSidebarTags();
    updateSidebarDisabledState(false);
  }
}

/* ── BOOT ────────────────────────────────────────────────── */
function init() {
  const feed = document.getElementById("feed");

  const bar = document.createElement("div");
  bar.className = "feed-progress";
  bar.innerHTML = `<div class="feed-progress__fill" id="progress-fill"></div>`;
  feed.appendChild(bar);

  const hint = document.createElement("div");
  hint.className = "swipe-hint";
  hint.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
    SWIPE RIGHT
  `;
  feed.appendChild(hint);

  initSidebar();
  loadArticles(null);
}

/* ── REBUILD FEED (after fetch/filter) ───────────────────── */
function rebuildFeed() {
  const feed = document.getElementById("feed");
  cards.forEach((c) => c.remove());
  cards = [];
  activeIndex = 0;

  hideFeedState();

  if (loadError) {
    renderFeedState("Could not load live articles. Showing cached fallback articles.");
  }

  if (!articles.length) {
    renderFeedState(activeTag ? `NOTHING` : "NOTHING");
    applyStack(true);
    updateProgress();
    updateReadLink();
    return;
  }

  articles.forEach((a, i) => {
    const el = buildCard(a, i);
    feed.appendChild(el);
    cards.push(el);
  });

  applyStack(true);
  updateProgress();
  updateReadLink();
}

function renderFeedState(message) {
  const feed = document.getElementById("feed");
  let state = document.getElementById("feed-state");

  if (!state) {
    state = document.createElement("div");
    state.id = "feed-state";
    state.className = "feed-state";
    feed.appendChild(state);
  }

  state.textContent = message;
}

function hideFeedState() {
  const state = document.getElementById("feed-state");
  if (state) state.remove();
}

/* ── BUILD CARD ─────────────────────────────────────────── */
function buildCard(article, idx) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.idx = idx;

  const bulletCount = article.bullets.length;
  const image = safeUrl(article.image, DEFAULT_IMAGE).replace(/"/g, "%22");
  const publisherLogo = safeUrl(article.publisher.logo, DEFAULT_PUBLISHER_LOGO).replace(/"/g, "%22");

  el.innerHTML = `
    <div class="card__image" style="background-image:url(&quot;${image}&quot;)">
      <div class="card__publisher">
        <div class="card__publisher-left">
          <div class="card__logo" style="background-image:url(&quot;https://ruludjzcqacclehqkppk.supabase.co/storage/v1/object/public/lathala/images/sources/${article.publisher.id}.webp&quot;)"></div>
          <div class="card__meta">
            <span class="card__pub-name">${escapeHtml(article.publisher.name)}</span>
            <span class="card__pub-date">${escapeHtml(formatDateForDisplay(article.date))}</span>
          </div>
        </div>
        <div class="card__tag">${escapeHtml(article.tag)}</div>
      </div>
    </div>

    <div class="card__content">
      <h2 class="card__title">${escapeHtml(article.title)}</h2>
      <div class="card__divider"></div>
      <div class="carousel">
        <div class="carousel__dot-track">
          ${article.bullets.map((_, i) => `<div class="carousel__dot-pip${i === 0 ? " active" : ""}"></div>`).join("")}
        </div>
        <div class="carousel__track">
          ${article.bullets
            .map(
              (b) => `
            <div class="carousel__item">
              <p class="carousel__text">${escapeHtml(b)}</p>
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
      setCardStyle(card, "translate3d(0,0,0) scale(0.8)", 0.5, 9, "none");
    } else if (offset === -1) {
      setCardStyle(card, "translate3d(0,0,0) scale(0.8)", 0, 8, "none");
    } else {
      setCardStyle(card, "translate3d(0,0,0) scale(0)", 0, 0, "none");
    }

    if (offset === 0) attachDrag(card);
  });

  updateReadLink();
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
  updateReadLink();
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

/* ── READ ARTICLE LINK ──────────────────────────────────── */
function updateReadLink() {
  const link = document.getElementById("read-article-link");
  if (!link) return;

  const article = articles[activeIndex];
  const url = article ? safeUrl(article.url, "#") : "#";
  link.href = url;
  link.classList.toggle("disabled", !article || url === "#");
  link.setAttribute("aria-disabled", !article || url === "#" ? "true" : "false");
}

/* ── SIDEBAR ─────────────────────────────────────────────── */
function initSidebar() {
  renderSidebarTags();
  document.getElementById("hamburger-btn").addEventListener("click", openSidebar);
  document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);
}

function renderSidebarTags() {
  const container = document.getElementById("sidebar-tags");
  container.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "sidebar-tag-btn" + (activeTag === null ? " active" : "");
  allBtn.innerHTML = `<span>All</span><span class="sidebar-tag-count">${allArticles.length || articles.length}</span>`;
  allBtn.dataset.tag = "";
  allBtn.disabled = isLoading;
  allBtn.addEventListener("click", () => filterByTag(null));
  container.appendChild(allBtn);

  FIXED_CATEGORIES.forEach((tag) => {
    const count = getCountForTag(tag);
    const btn = document.createElement("button");
    btn.className = "sidebar-tag-btn" + (activeTag === tag ? " active" : "");
    btn.dataset.tag = tag;
    btn.disabled = isLoading;
    btn.innerHTML = `<span>${escapeHtml(tag)}</span><span class="sidebar-tag-count">${count}</span>`;
    btn.addEventListener("click", () => filterByTag(tag));
    container.appendChild(btn);
  });
}

function updateSidebarDisabledState(disabled) {
  document.querySelectorAll(".sidebar-tag-btn").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("open");
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
}

async function filterByTag(tag) {
  if (isLoading || activeTag === tag) {
    closeSidebar();
    return;
  }

  activeTag = tag;
  renderSidebarTags();
  closeSidebar();

  if (tag === null && allArticles.length) {
    articles = allArticles;
    rebuildFeed();
    renderSidebarTags();
    return;
  }

  await loadArticles(tag);
}

/* ── GO ──────────────────────────────────────────────────── */
init();
