"use strict";

/* ==========================================================
   RUNTIME STORE
========================================================== */
class AppStore {
  constructor() {
    this.resetForNewPage();
    this.appTemplate = null;
    this.noContentTemplate = null;
    this.hasCompletedInitialReveal = false;
    this.hasDismissedSwipeHint = false;
    this.pageResourcesPromise = null;
    this.resizeTimerId = null;
    this.revealTimerId = null;
    this.preloadTimerId = null;
    this.viewportRun = 0;
    this.revealRun = 0;
    this.stackRun = 0;
    this.swipeRun = 0;
    this.isDraggingCard = false;
  }

  resetForNewPage() {
    this.allArticles = [];
    this.visibleArticles = [];
    this.cards = [];
    this.activeIndex = 0;
    this.activeTag = null;
    this.isInitialized = false;
    this.isLoading = false;
    this.isViewportAllowed = false;
    this.loadError = null;
    this.isDraggingCard = false;
  }

  resetAfterUnmount() {
    this.viewportRun += 1;
    this.isInitialized = false;
    this.isLoading = false;
    this.cards = [];
    this.activeIndex = 0;
    this.revealRun += 1;
    this.stackRun += 1;
    this.swipeRun += 1;
    this.isDraggingCard = false;
    clearTimeout(this.revealTimerId);
    clearTimeout(this.preloadTimerId);
    this.revealTimerId = null;
    this.preloadTimerId = null;
  }
}

class DomRegistry {
  constructor(config) {
    this.config = config;
    this.nodes = {};
  }

  cache() {
    const selectors = this.config.selectors;
    this.nodes.app = Dom.$(selectors.app);
    this.nodes.feed = Dom.$(selectors.feed);
    this.nodes.sidebar = Dom.$(selectors.sidebar);
    this.nodes.sidebarTags = Dom.$(selectors.sidebarTags);
    this.nodes.sidebarClose = Dom.$(selectors.sidebarClose);
    this.nodes.sidebarOverlay = Dom.$(selectors.sidebarOverlay);
    this.nodes.copyrightYear = Dom.$(selectors.copyrightYear);
    this.nodes.hamburgerButton = Dom.$(selectors.hamburgerButton);
    this.nodes.readArticleLink = Dom.$(selectors.readArticleLink);
    this.nodes.bottomNav = Dom.$(selectors.bottomNav);
    this.nodes.bootLoader = Dom.$(selectors.bootLoader);
    this.nodes.swipeHint = Dom.$(selectors.swipeHint);
    this.nodes.pullRefresh = Dom.$(selectors.pullRefresh);
    this.nodes.pullRefreshText = Dom.$(selectors.pullRefreshText);
    return this.nodes;
  }

  clear() {
    this.nodes = {};
  }
}
