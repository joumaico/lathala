"use strict";

/* ==========================================================
   PULL-TO-REFRESH COMPONENT
========================================================== */
class PullRefreshComponent {
  constructor(config, domRegistry, store, callbacks = {}) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
    this.callbacks = callbacks;
    this.boundFeed = null;
    this.state = this.createState();
  }

  bind() {
    const app = this.domRegistry.nodes.app;
    const feed = this.domRegistry.nodes.feed;
    if (!app || !feed || this.boundFeed === feed) return;

    this.render();
    this.boundFeed = feed;

    if (this.shouldUseTouchEvents()) {
      feed.addEventListener("touchstart", (event) => this.handleStart(event), { passive: true });
      feed.addEventListener("touchmove", (event) => this.handleMove(event), { passive: false });
      feed.addEventListener("touchend", () => this.handleEnd(), { passive: true });
      feed.addEventListener("touchcancel", () => this.cancel(), { passive: true });
      return;
    }

    if (window.PointerEvent) {
      feed.addEventListener("pointerdown", (event) => this.handleStart(event), { passive: true });
      feed.addEventListener("pointermove", (event) => this.handleMove(event), { passive: false });
      feed.addEventListener("pointerup", () => this.handleEnd());
      feed.addEventListener("pointercancel", () => this.cancel());
      return;
    }

    feed.addEventListener("touchstart", (event) => this.handleStart(event), { passive: true });
    feed.addEventListener("touchmove", (event) => this.handleMove(event), { passive: false });
    feed.addEventListener("touchend", () => this.handleEnd(), { passive: true });
    feed.addEventListener("touchcancel", () => this.cancel(), { passive: true });
  }

  shouldUseTouchEvents() {
    return "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  }

  render() {
    const app = this.domRegistry.nodes.app;
    if (!app) return;

    if (!Dom.$(this.config.selectors.pullRefresh, app)) {
      app.insertAdjacentHTML("beforeend", this.config.templates.pullRefresh);
    }

    this.domRegistry.nodes.pullRefresh = Dom.$(this.config.selectors.pullRefresh, app);
    this.domRegistry.nodes.pullRefreshText = Dom.$(this.config.selectors.pullRefreshText, app);
    this.setText(this.config.labels.pullToRefresh);
    this.setPullDistance(0);
  }

  createState() {
    return {
      startX: 0,
      startY: 0,
      pointerId: null,
      isLive: false,
      isPulling: false,
      isRefreshing: false,
      direction: null,
      progress: 0,
      distance: 0,
      rafId: null,
      statusText: "",
    };
  }

  handleStart(event) {
    if (!this.canStart(event)) return;

    const point = this.getGesturePoint(event);
    if (!point || !this.isInsideStartZone(point)) return;

    this.state.startX = point.clientX;
    this.state.startY = point.clientY;
    this.state.pointerId = event.pointerId ?? null;
    this.state.isLive = true;
    this.state.isPulling = false;
    this.state.direction = null;
    this.state.progress = 0;
    this.state.distance = 0;
    this.state.statusText = "";
    if (this.state.rafId) {
      cancelAnimationFrame(this.state.rafId);
      this.state.rafId = null;
    }
  }

  handleMove(event) {
    if (!this.state.isLive || this.state.isRefreshing) return;
    if (this.state.pointerId !== null && event.pointerId !== this.state.pointerId) return;

    const point = this.getGesturePoint(event);
    if (!point) return;

    const dx = point.clientX - this.state.startX;
    const dy = point.clientY - this.state.startY;
    const lockPx = this.config.gesture.directionLockPx;

    if (!this.state.direction && (Math.abs(dx) > lockPx || Math.abs(dy) > lockPx)) {
      this.state.direction = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    }

    if (this.state.direction === "horizontal" || dy <= 0) return;
    if (this.state.direction !== "vertical") return;

    if (event.cancelable) event.preventDefault();

    const distance = this.getPullDistance(dy);
    const threshold = this.config.pullRefresh.thresholdPx;
    const progress = Math.min(distance / threshold, 1);

    this.state.isPulling = true;
    this.state.progress = progress;

    this.state.distance = distance;
    this.schedulePullFrame();
  }

  async handleEnd() {
    if (!this.state.isLive) return;

    const shouldRefresh = this.state.isPulling && this.state.progress >= 1;
    this.state.isLive = false;
    this.state.pointerId = null;
    this.state.direction = null;

    if (!shouldRefresh) {
      this.reset();
      return;
    }

    await this.refresh();
  }

  async refresh() {
    const app = this.domRegistry.nodes.app;
    if (!app || this.state.isRefreshing) return;

    this.state.isRefreshing = true;
    app.classList.remove(this.config.classes.readyToRefresh);
    app.classList.add(this.config.classes.refreshing);
    this.domRegistry.nodes.pullRefresh?.setAttribute("aria-hidden", "false");
    this.setPullDistance(this.config.pullRefresh.holdPx);
    this.setText(this.config.labels.refreshing);

    try {
      await this.callbacks.onRefresh?.();
      this.setText(this.store.loadError ? this.config.labels.refreshFailed : this.config.labels.refreshed);
    } catch (error) {
      console.error(error);
      this.setText(this.config.labels.refreshFailed);
    } finally {
      await Time.delay(this.config.pullRefresh.settleMs);
      this.state.isRefreshing = false;
      this.reset();
    }
  }

  cancel() {
    this.state.isLive = false;
    this.state.pointerId = null;
    this.reset();
  }

  reset() {
    const app = this.domRegistry.nodes.app;
    if (this.state.rafId) {
      cancelAnimationFrame(this.state.rafId);
      this.state.rafId = null;
    }

    app?.classList.remove(this.config.classes.pulling, this.config.classes.refreshing, this.config.classes.readyToRefresh);
    this.domRegistry.nodes.pullRefresh?.setAttribute("aria-hidden", "true");
    this.setText(this.config.labels.pullToRefresh);
    this.setPullDistance(0);
    this.state.isPulling = false;
    this.state.progress = 0;
    this.state.distance = 0;
    this.state.statusText = "";
  }

  schedulePullFrame() {
    if (this.state.rafId) return;

    this.state.rafId = requestAnimationFrame(() => {
      this.state.rafId = null;
      this.renderPullFrame();
    });
  }

  renderPullFrame() {
    const app = this.domRegistry.nodes.app;
    if (!app || !this.state.isPulling) return;

    const isReady = this.state.progress >= 1;
    const text = isReady ? this.config.labels.releaseToRefresh : this.config.labels.pullToRefresh;

    app.classList.add(this.config.classes.pulling);
    app.classList.toggle(this.config.classes.readyToRefresh, isReady);
    this.domRegistry.nodes.pullRefresh?.setAttribute("aria-hidden", "false");
    this.setText(text);
    this.setPullDistance(this.state.distance);
  }

  canStart(event) {
    if (!this.store.isViewportAllowed || this.store.isLoading || this.state.isRefreshing) return false;
    if (event.pointerType === "mouse" && event.button !== 0) return false;

    const target = event.target;
    if (!(target instanceof Element)) return true;
    if (target.closest("button, a, .sidebar, .sidebar-overlay, .bottom-nav")) return false;

    const carousel = target.closest(this.config.selectors.carouselTrack);
    if (carousel && carousel.scrollTop > 1) return false;

    return true;
  }

  isInsideStartZone(point) {
    const app = this.domRegistry.nodes.app;
    if (!app) return false;

    const rect = app.getBoundingClientRect();
    const ratio = this.config.pullRefresh.startZoneRatio ?? 0.8;
    const clampedRatio = Math.min(Math.max(ratio, 0), 1);
    const startZoneBottom = rect.top + rect.height * clampedRatio;

    return point.clientY >= rect.top && point.clientY <= startZoneBottom;
  }

  getPullDistance(dy) {
    const resisted = dy * this.config.pullRefresh.resistance;
    return Math.min(resisted, this.config.pullRefresh.maxPullPx);
  }

  setPullDistance(distance) {
    const app = this.domRegistry.nodes.app;
    if (!app) return;

    const rounded = Math.max(0, Math.round(distance));
    const spin = Math.round(this.state.progress * 270);
    app.style.setProperty("--pull-y", `${rounded}px`);
    app.style.setProperty("--pull-spin", `${spin}deg`);
  }

  setText(text) {
    if (this.state.statusText === text) return;

    const node = this.domRegistry.nodes.pullRefreshText;
    if (node) node.textContent = text;
    this.state.statusText = text;
  }

  getGesturePoint(event) {
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (touch) return { clientX: touch.clientX, clientY: touch.clientY };
    if (typeof event.clientX === "number" && typeof event.clientY === "number") return { clientX: event.clientX, clientY: event.clientY };
    return null;
  }
}
