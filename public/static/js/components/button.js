"use strict";

/* ==========================================================
   READ BUTTON COMPONENT
========================================================== */
class ReadButtonComponent {
  constructor(config, domRegistry, store) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
  }

  update() {
    const { readArticleLink, bottomNav } = this.domRegistry.nodes;
    if (!readArticleLink || !bottomNav) return;

    const article = !this.store.isLoading ? this.store.visibleArticles[this.store.activeIndex] : null;
    const url = article ? Urls.safe(article.url, "#") : "#";
    const canRead = Boolean(this.store.isViewportAllowed && !this.store.isGridLayout && article && url !== "#");

    readArticleLink.href = canRead ? url : "#";
    readArticleLink.classList.toggle(this.config.classes.disabled, !canRead);
    readArticleLink.setAttribute("aria-disabled", canRead ? "false" : "true");
    readArticleLink.tabIndex = canRead ? 0 : -1;

    bottomNav.classList.toggle(this.config.classes.hidden, !canRead);
    bottomNav.setAttribute("aria-hidden", canRead ? "false" : "true");
  }
}
