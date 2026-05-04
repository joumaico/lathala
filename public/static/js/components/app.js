"use strict";

/* ==========================================================
   APP CONTROLLER
========================================================== */
class AppController {
  constructor(config) {
    this.config = config;
    this.store = new AppStore();
    this.domRegistry = new DomRegistry(config);
    this.repository = new ArticleRepository(config);

    this.bootLoader = new BootLoaderComponent(config, this.domRegistry, this.store);
    this.readButton = new ReadButtonComponent(config, this.domRegistry, this.store);
    this.feedChrome = new FeedChromeComponent(config, this.domRegistry, this.store);
    this.cardFactory = new ArticleCardFactory(config, this.repository);
    this.cardStack = new CardStackController(config, this.domRegistry, this.store, this.feedChrome, this.readButton, {
      ensureCardAtIndex: (index) => this.feed?.ensureCardAtIndex(index),
      syncCardWindow: () => this.feed?.syncCardWindow(),
      preloadAroundIndex: (index) => this.queueImagePreloadAroundIndex(index),
    });
    this.feed = new FeedComponent(config, this.domRegistry, this.store, this.cardFactory, this.feedChrome, this.cardStack, this.readButton);
    this.pullRefresh = new PullRefreshComponent(config, this.domRegistry, this.store, {
      onRefresh: () => this.refreshCurrentFeed(),
    });
    this.sidebar = new SidebarComponent(config, this.domRegistry, this.store, {
      onSelectTag: (tag) => this.filterByTag(tag),
    });

    this.viewport = new ViewportGate(config, this.store, this.domRegistry, {
      onAllowed: () => this.initMobileApp(),
      onBeforeBlocked: () => this.sidebar.close(),
    });
  }

  boot() {
    this.viewport.boot();
  }

  initMobileApp() {
    if (this.store.isInitialized || !this.store.isViewportAllowed) return;

    this.domRegistry.cache();

    if (this.store.hasCompletedInitialReveal) this.bootLoader.hide();
    else this.bootLoader.show();

    this.feedChrome.render();
    this.pullRefresh.bind();
    this.sidebar.bind();

    this.store.isInitialized = true;
    this.loadArticles(null);
  }

  async loadArticles(tag = null) {
    const loadRun = this.store.viewportRun;
    const isInitialLoad = !this.store.hasCompletedInitialReveal && tag === null;

    this.store.isLoading = true;
    this.store.loadError = null;
    this.feedChrome.showState(this.config.messages.loading);
    this.feedChrome.updateSwipeHint();
    this.readButton.update();
    this.sidebar.setDisabled(true);

    try {
      const loadedArticles = await this.repository.fetchArticlesByTag(tag);
      this.store.visibleArticles = loadedArticles;

      if (tag === null) {
        this.store.allArticles = loadedArticles;
      } else if (!this.store.allArticles.length) {
        this.store.allArticles = this.repository.getFallbackArticles(null);
      }
    } catch (error) {
      console.error(error);
      this.store.loadError = error.message;

      if (!this.store.allArticles.length) {
        this.store.allArticles = this.repository.getFallbackArticles(null);
      }

      this.store.visibleArticles = tag ? this.store.allArticles.filter((article) => article.tag === tag) : this.store.allArticles;
    } finally {
      this.store.isLoading = false;

      if (this.shouldCancelLoad(loadRun)) return;

      if (isInitialLoad) {
        await this.finishInitialLoad(loadRun);
        return;
      }

      this.repository.preloadArticleImages(this.getInitialPreloadArticles()).catch((error) => console.warn("Image preload failed:", error));
      this.feed.rebuild();
      this.sidebar.render();
      this.sidebar.setDisabled(false);
    }
  }

  async finishInitialLoad(loadRun) {
    await this.waitForPageResources();
    if (this.shouldCancelLoad(loadRun)) return;

    const preloadPromise = this.repository.preloadArticleImages(this.getInitialPreloadArticles());

    this.feed.rebuild();
    this.sidebar.render();
    this.sidebar.setDisabled(false);

    await Time.delay(this.config.startup.revealDelayMs);
    if (this.shouldCancelLoad(loadRun)) return;

    this.bootLoader.hide();
    preloadPromise.catch((error) => console.warn("Image preload failed:", error));
  }


  getInitialPreloadArticles() {
    const size = Math.max(1, Number(this.config.cardWindow?.preloadAhead || this.config.cardWindow?.size) || 10);
    return this.store.visibleArticles.slice(0, size);
  }

  queueImagePreloadAroundIndex(index) {
    clearTimeout(this.store.preloadTimerId);

    const runPreload = () => {
      const articles = this.getPreloadArticlesAroundIndex(index);
      if (!articles.length) return;
      this.repository.preloadArticleImages(articles).catch((error) => console.warn("Image preload failed:", error));
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(runPreload, { timeout: 500 });
      this.store.preloadTimerId = setTimeout(() => window.cancelIdleCallback?.(idleId), 1200);
      return;
    }

    this.store.preloadTimerId = setTimeout(runPreload, 40);
  }

  getPreloadArticlesAroundIndex(index) {
    const ahead = Math.max(1, Number(this.config.cardWindow?.preloadAhead) || 10);
    const start = Math.max(0, index - 1);
    const end = Math.min(this.store.visibleArticles.length, index + ahead + 1);
    return this.store.visibleArticles.slice(start, end);
  }

  waitForPageResources() {
    if (!this.store.pageResourcesPromise) this.store.pageResourcesPromise = Time.waitForPageLoad();
    return this.store.pageResourcesPromise;
  }

  shouldCancelLoad(loadRun) {
    const app = this.domRegistry.nodes.app;
    return loadRun !== this.store.viewportRun || !this.store.isViewportAllowed || !app?.isConnected;
  }

  async refreshCurrentFeed() {
    if (this.store.isLoading) return;
    await this.loadArticles(this.store.activeTag);
  }

  async filterByTag(tag) {
    if (this.store.isLoading || this.store.activeTag === tag) {
      this.sidebar.close();
      return;
    }

    this.store.activeTag = tag;
    this.sidebar.render();
    this.sidebar.close();

    if (tag === null && this.store.allArticles.length) {
      this.store.visibleArticles = this.store.allArticles;
      this.queueImagePreloadAroundIndex(0);
      this.feed.rebuild();
      this.sidebar.render();
      return;
    }

    await this.loadArticles(tag);
  }
}
