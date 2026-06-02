"use strict";

/* ==========================================================
   FEED CHROME COMPONENT
========================================================== */
class FeedChromeComponent {
  constructor(config, domRegistry, store) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
  }

  render() {
    const feed = this.domRegistry.nodes.feed;
    if (!feed) return;

    if (!Dom.$(this.config.selectors.progressFill, feed)) {
      feed.insertAdjacentHTML("afterbegin", this.config.templates.feedProgress);
    }

    this.domRegistry.nodes.progressFill = Dom.$(this.config.selectors.progressFill, feed);

    if (!this.store.hasDismissedSwipeHint && !Dom.$(this.config.selectors.swipeHint, feed)) {
      feed.insertAdjacentHTML("beforeend", this.config.templates.swipeHint);
    }

    this.domRegistry.nodes.swipeHint = Dom.$(this.config.selectors.swipeHint, feed);
    this.updateProgress();
    this.updateSwipeHint();
  }

  showState(message) {
    const feed = this.domRegistry.nodes.feed;
    if (!feed) return;

    let stateElement = Dom.$(this.config.selectors.feedState, feed);
    if (!stateElement) {
      stateElement = document.createElement("div");
      stateElement.id = "feed-state";
      stateElement.className = "feed-state";
      feed.appendChild(stateElement);
    }

    stateElement.textContent = message;
    this.updateSwipeHint();
  }

  hideState() {
    Dom.$(this.config.selectors.feedState)?.remove();
    this.updateSwipeHint();
  }

  updateProgress() {
    const fill = this.domRegistry.nodes.progressFill || Dom.$(this.config.selectors.progressFill);
    if (!fill) return;

    const total = this.store.visibleArticles.length;
    const progress = total > 0 ? (this.store.activeIndex + 1) / total : 0;
    const clamped = Math.max(0, Math.min(1, progress));
    fill.style.transform = `scaleX(${clamped})`;
  }

  updateSwipeHint() {
    const hint = this.domRegistry.nodes.swipeHint || Dom.$(this.config.selectors.swipeHint);
    if (!hint) return;

    if (this.store.hasDismissedSwipeHint) {
      hint.remove();
      this.domRegistry.nodes.swipeHint = null;
      return;
    }

    const total = this.store.visibleArticles.length;
    const canSwipeLeftToNext = this.store.activeIndex < total - 1;
    const shouldShow = Boolean(this.store.isViewportAllowed && !this.store.isGridLayout && !this.store.isLoading && total > 1 && canSwipeLeftToNext);

    hint.classList.toggle(this.config.classes.hidden, !shouldShow);
    hint.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  }
}
