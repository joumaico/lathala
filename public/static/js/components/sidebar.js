"use strict";

/* ==========================================================
   SIDEBAR COMPONENT
========================================================== */
class SidebarComponent {
  constructor(config, domRegistry, store, callbacks) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
    this.callbacks = callbacks;
  }

  bind() {
    const { hamburgerButton, sidebarClose, sidebarOverlay } = this.domRegistry.nodes;
    hamburgerButton?.addEventListener("click", () => this.open());
    sidebarClose?.addEventListener("click", () => this.close());
    sidebarOverlay?.addEventListener("click", () => this.close());
    this.updateCopyrightYear();
  }

  open() {
    if (!this.store.isViewportAllowed) return;
    this.domRegistry.nodes.sidebar?.classList.add(this.config.classes.open);
    this.domRegistry.nodes.sidebarOverlay?.classList.add(this.config.classes.open);
  }

  close() {
    this.domRegistry.nodes.sidebar?.classList.remove(this.config.classes.open);
    this.domRegistry.nodes.sidebarOverlay?.classList.remove(this.config.classes.open);
  }

  render() {
    this.updateCopyrightYear();

    const sidebarTags = this.domRegistry.nodes.sidebarTags;
    if (!sidebarTags) return;

    sidebarTags.innerHTML = "";
    sidebarTags.appendChild(this.createTagButton(null, this.config.labels.allCategory, this.getAllCount()));

    this.config.categories.forEach((tag) => {
      sidebarTags.appendChild(this.createTagButton(tag, tag, this.countForTag(tag)));
    });
  }

  createTagButton(tag, label, count) {
    const button = document.createElement("button");
    const isActive = this.store.activeTag === tag;

    button.className = `sidebar-tag-btn${isActive ? ` ${this.config.classes.active}` : ""}`;
    button.dataset.tag = tag ?? "";
    button.disabled = this.store.isLoading;
    button.innerHTML = `<span>${Text.escape(label)}</span><span class="sidebar-tag-count">${count}</span>`;
    button.addEventListener("click", () => this.callbacks.onSelectTag?.(tag));

    return button;
  }

  updateCopyrightYear() {
    const yearNode = this.domRegistry.nodes.copyrightYear || Dom.$(this.config.selectors.copyrightYear);
    if (!yearNode) return;

    yearNode.textContent = String(new Date().getFullYear());
    this.domRegistry.nodes.copyrightYear = yearNode;
  }

  setDisabled(disabled) {
    Dom.all(".sidebar-tag-btn").forEach((button) => {
      button.disabled = disabled;
    });
  }

  getAllCount() {
    return this.store.allArticles.length || this.store.visibleArticles.length;
  }

  countForTag(tag) {
    return this.store.allArticles.filter((article) => article.tag === tag).length;
  }
}
