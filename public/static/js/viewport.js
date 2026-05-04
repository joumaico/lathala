"use strict";

/* ==========================================================
   VIEWPORT GATE
========================================================== */
class ViewportGate {
  constructor(config, store, domRegistry, callbacks) {
    this.config = config;
    this.store = store;
    this.domRegistry = domRegistry;
    this.callbacks = callbacks;
  }

  boot() {
    this.captureTemplates();
    this.sync();
    window.addEventListener("resize", () => this.queueSync());
  }

  queueSync() {
    clearTimeout(this.store.resizeTimerId);
    this.store.resizeTimerId = setTimeout(() => this.sync(), this.config.viewport.resizeDebounceMs);
  }

  captureTemplates() {
    if (!this.store.appTemplate) {
      const app = Dom.$(this.config.selectors.app);
      if (app) this.store.appTemplate = app.cloneNode(true);
    }

    if (!this.store.noContentTemplate) {
      const noContent = Dom.$(this.config.selectors.noContent);
      if (noContent) this.store.noContentTemplate = noContent.cloneNode(true);
    }
  }

  sync() {
    if (!this.isAllowed()) {
      this.blockApp();
      return;
    }

    this.allowApp();
  }

  isAllowed() {
    return window.innerWidth < this.config.viewport.maxWidth;
  }

  allowApp() {
    this.store.isViewportAllowed = true;
    this.removeNoContentNode();

    if (!this.mountAppNode()) return;
    this.callbacks.onAllowed?.();
  }

  blockApp() {
    this.store.isViewportAllowed = false;
    this.callbacks.onBeforeBlocked?.();
    this.removeAppNode();
    this.mountNoContentNode();
  }

  mountAppNode() {
    if (Dom.$(this.config.selectors.app)) return true;
    if (!this.store.appTemplate) return false;

    document.body.insertAdjacentElement("afterbegin", this.store.appTemplate.cloneNode(true));
    return true;
  }

  removeAppNode() {
    const app = Dom.$(this.config.selectors.app);
    if (app) app.remove();

    this.store.resetAfterUnmount();
    this.domRegistry.clear();
  }

  mountNoContentNode() {
    if (Dom.$(this.config.selectors.noContent)) return true;
    if (!this.store.noContentTemplate) return false;

    document.body.insertAdjacentElement("afterbegin", this.store.noContentTemplate.cloneNode(true));
    return true;
  }

  removeNoContentNode() {
    Dom.$(this.config.selectors.noContent)?.remove();
  }
}
