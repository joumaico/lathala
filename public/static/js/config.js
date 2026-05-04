"use strict";

/* ==========================================================
   APP CONFIGURATION
   Edit content, API, labels, timing, and selectors here.
========================================================== */
const APP_CONFIG = {
  viewport: {
    maxWidth: 500,
    resizeDebounceMs: 120,
  },

  startup: {
    revealDelayMs: 2000,
  },

  pullRefresh: {
    // Allow pull-to-refresh to start within the top 80% of the app viewport.
    startZoneRatio: 0.8,
    thresholdPx: 74,
    maxPullPx: 112,
    resistance: 0.58,
    holdPx: 58,
    settleMs: 280,
  },

  cardWindow: {
    // Low-power swipe mode keeps only previous/current/next cards mounted.
    // More cards = smoother preview depth, fewer cards = much lower CPU/GPU.
    size: 10,
    keepBehind: 1,
    // Keep image warming small. Decoding too many images ahead can stutter phones.
    preloadAhead: 2,
  },

  api: {
    supabaseUrl: "https://ruludjzcqacclehqkppk.supabase.co",
    anonKey: "sb_publishable_9ZW1kHjsWy4vkHIYvEd6Mg_vG_hpFnc",
    rpcName: "get_articles_by_tag",
    appConfigRpcName: "get_app_config",
    tagParam: "tag",
  },

  assets: {
    defaultImage: "static/images/fallback/placeholder.png",
    defaultPublisherLogo: "static/images/fallback/publisher.png",
  },

  categories: ["World", "National", "Politics", "Business", "Technology", "Health", "Sports", "Entertainment"],

  selectors: {
    app: "#app",
    noContent: "#mask",
    feed: "#feed",
    sidebar: "#sidebar",
    sidebarTags: "#sidebar-tags",
    sidebarClose: "#sidebar-close",
    sidebarOverlay: "#sidebar-overlay",
    copyrightYear: "#copyright-year",
    hamburgerButton: "#hamburger-btn",
    readArticleLink: "#read-article-link",
    bottomNav: ".bottom-nav",
    bootLoader: "#app-loader",
    feedState: "#feed-state",
    progressFill: "#progress-fill",
    swipeHint: ".swipe-hint",
    pullRefresh: ".pull-refresh",
    pullRefreshText: ".pull-refresh__text",
    cardImage: ".card__image",
    cardLogo: ".card__logo",
    carouselTrack: ".carousel__track",
    carouselPip: ".carousel__dot-pip",
  },

  classes: {
    active: "active",
    arriving: "arriving",
    booting: "is-booting",
    disabled: "disabled",
    hidden: "is-hidden",
    leaving: "leaving",
    open: "open",
    swiping: "is-swiping",
    dragging: "is-dragging",
    pulling: "is-pulling",
    refreshing: "is-refreshing",
    readyToRefresh: "is-ready-to-refresh",
  },

  labels: {
    allCategory: "All",
    pullToRefresh: "PULL TO REFRESH",
    releaseToRefresh: "RELEASE TO REFRESH",
    refreshing: "REFRESHING",
    refreshed: "UPDATED",
    refreshFailed: "REFRESH FAILED",
  },

  messages: {
    loading: "LOADING",
    noArticles: "NOTHING",
    defaultBullet: "No summary bullets are available for this article yet.",
    untitledArticle: "Untitled Article",
    uncategorized: "Uncategorized",
    defaultPublisherName: "Lathala",
  },

  gesture: {
    swipeThreshold: 68,
    velocitySwipeThreshold: 0.38,
    dragResistance: 0.06,
    directionLockPx: 7,
    dragFramePrecisionPx: 1,
    exitDistance: "110%",
  },

  animation: {
    flyMs: 180,
    fastFlyMinMs: 90,
    revealMs: 360,
    stackMs: 180,
    springMs: 180,
    pipLeaveCleanupMs: 1000,
    pipArriveCleanupMs: 100,
  },

  stack: {
    // Low-power stack: no idle scaling. Cards sit flat behind the active card,
    // so swiping only changes one compositor layer instead of several.
    active: { transform: "translate3d(0,0,0)", opacity: "1", zIndex: "10", pointerEvents: "auto" },
    next: { transform: "translate3d(0,0,0)", opacity: "1", zIndex: "9", pointerEvents: "none" },
    previous: { transform: "translate3d(0,0,0)", opacity: "1", zIndex: "8", pointerEvents: "none" },
    hidden: { transform: "translate3d(0,0,0)", opacity: "0", zIndex: "0", pointerEvents: "none" },
  },

  templates: {
    feedProgress: '<div class="feed-progress"><div class="feed-progress__fill" id="progress-fill"></div></div>',
    pullRefresh: `
      <div class="pull-refresh" role="status" aria-live="polite" aria-hidden="true">
        <div class="pull-refresh__pill">
          <span class="pull-refresh__ring" aria-hidden="true"></span>
          <span class="pull-refresh__text">PULL TO REFRESH</span>
        </div>
      </div>
    `,
    swipeHint: `
      <div class="swipe-hint">
        <i class="fa-solid fa-arrow-left"></i>
        <span>SWIPE</span>
        <i class="fa-solid fa-arrow-right"></i>
      </div>
    `,
  },

  fallbackArticles: [
    {
      image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
      title: "Patients Face Predatory Medical Credit Card Practices",
      author: "Mary Grace Piattos",
      tag: "Business",
      url: "https://google.com",
      bullets: ["High-interest medical credit traps patients in long debt cycles.", "Hidden fees compound the burden well beyond the original bill.", "Many patients sign agreements without understanding full terms.", "Advocates push for stronger federal consumer protections now."],
      date: "2026-05-05T14:48:45Z",
      publisher: { name: "Inquirer.net", logo: "static/images/fallback/publisher.png" },
    },
    {
      image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80",
      title: "AI Reshapes the Future of Remote Work Globally",
      author: "Xiaomi Ocho",
      tag: "Technology",
      url: "https://google.com",
      bullets: ["Automation is steadily replacing routine office-based tasks.", "Collaboration tools now ship with built-in AI co-pilots.", "Companies are shrinking headquarters footprints worldwide.", "Workers in all sectors must reskill to remain competitive."],
      date: "2026-05-05T12:23:12Z",
      publisher: { name: "Manila Bulletin", logo: "static/images/fallback/publisher.png" },
    },
    {
      image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
      title: "Climate Crisis Pushes Pacific Islands to Relocate",
      author: "John Doe, Emily Rose",
      tag: "Health",
      url: "https://google.com",
      bullets: ["Rising seas now threaten entire island communities daily.", "Governments have launched funded mass-relocation programs.", "Cultural identity is deeply at risk from forced displacement.", "International aid pledges still fall short of what is needed."],
      date: "2026-05-04T02:12:13Z",
      publisher: { name: "GMA News", logo: "static/images/fallback/publisher.png" },
    },
  ],
};

window.LATHALA_CONFIG = APP_CONFIG;
