"use strict";

/* ==========================================================
   BOOT LOADER COMPONENT
========================================================== */
class BootLoaderComponent {
  constructor(config, domRegistry, store) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
  }

  show() {
    const { app, bootLoader } = this.domRegistry.nodes;
    app?.classList.add(this.config.classes.booting);
    app?.setAttribute("aria-busy", "true");
    bootLoader?.classList.remove(this.config.classes.hidden);
  }

  hide() {
    const { app, bootLoader } = this.domRegistry.nodes;
    app?.classList.remove(this.config.classes.booting);
    app?.removeAttribute("aria-busy");

    if (bootLoader) {
      bootLoader.classList.add(this.config.classes.hidden);
      bootLoader.remove();
      this.domRegistry.nodes.bootLoader = null;
    }

    this.store.hasCompletedInitialReveal = true;
  }
}
