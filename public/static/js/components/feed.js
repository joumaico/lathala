"use strict";

/* ==========================================================
   FEED COMPONENT
========================================================== */
class FeedComponent {
  constructor(config, domRegistry, store, cardFactory, feedChrome, cardStack, readButton) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
    this.cardFactory = cardFactory;
    this.feedChrome = feedChrome;
    this.cardStack = cardStack;
    this.readButton = readButton;
  }

  rebuild() {
    const feed = this.domRegistry.nodes.feed;
    if (!feed) return;

    this.clearCards();
    this.store.activeIndex = 0;
    this.feedChrome.hideState();

    if (!this.store.visibleArticles.length) {
      this.feedChrome.showState(this.config.messages.noArticles);
      this.cardStack.apply(true);
      this.feedChrome.updateProgress();
      this.readButton.update();
      this.feedChrome.updateSwipeHint();
      return;
    }

    this.store.cards = new Array(this.store.visibleArticles.length);

    if (this.store.isGridLayout) {
      this.buildGrid();
      this.feedChrome.updateProgress();
      this.readButton.update();
      this.feedChrome.updateSwipeHint();
      return;
    }

    // Stack mode keeps only the current card window mounted. This keeps
    // progress/index logic simple without retaining every card on phones.
    this.syncCardWindow();

    this.cardStack.apply(true);
    this.feedChrome.updateProgress();
    this.readButton.update();
    this.feedChrome.updateSwipeHint();
    this.cardStack.revealActiveCard();
  }

  clearCards() {
    this.store.stackRun += 1;
    this.store.revealRun += 1;
    clearTimeout(this.store.revealTimerId);
    this.store.revealTimerId = null;
    this.store.cards.forEach((card) => card?.remove());
    this.store.cards = [];
  }

  ensureCardAtIndex(index) {
    const feed = this.domRegistry.nodes.feed;
    const article = this.store.visibleArticles[index];
    if (!feed || !article) return null;

    if (this.store.cards[index]?.isConnected) return this.store.cards[index];

    const card = this.cardFactory.create(article, index);
    feed.appendChild(card);
    this.store.cards[index] = card;
    return card;
  }

  buildGrid() {
    const feed = this.domRegistry.nodes.feed;
    if (!feed) return;

    const fragment = document.createDocumentFragment();

    this.store.visibleArticles.forEach((article, index) => {
      const card = this.cardFactory.create(article, index, { disableBulletCarousel: true, disableTitleBreaks: true });
      const tileLink = this.createGridTileLink(article, card);
      this.resetCardInlineStyles(card);
      fragment.appendChild(tileLink);
      this.store.cards[index] = tileLink;
    });

    feed.appendChild(fragment);
  }

  createGridTileLink(article, card) {
    const url = Urls.safe(article.url, "#");
    const link = document.createElement("a");

    link.className = "article-tile-link";
    link.href = url;
    link.setAttribute("aria-label", `Read article: ${article.title || this.config.messages.untitledArticle}`);

    if (url === "#") {
      link.classList.add("article-tile-link--disabled");
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
      link.addEventListener("click", (event) => event.preventDefault());
    } else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    link.appendChild(card);
    return link;
  }

  resetCardInlineStyles(card) {
    if (!card?.style) return;

    card.style.transition = "";
    card.style.transform = "";
    card.style.opacity = "";
    card.style.zIndex = "";
    card.style.pointerEvents = "";
    card.style.willChange = "";
  }

  syncCardWindow() {
    if (this.store.isGridLayout) return;
    if (!this.store.visibleArticles.length) return;

    const { start, end } = this.getCardWindowRange();
    const fragment = document.createDocumentFragment();

    for (let index = start; index < end; index += 1) {
      const card = this.store.cards[index];
      if (card?.isConnected) continue;

      const article = this.store.visibleArticles[index];
      if (!article) continue;

      const nextCard = this.cardFactory.create(article, index);
      fragment.appendChild(nextCard);
      this.store.cards[index] = nextCard;
    }

    this.domRegistry.nodes.feed?.appendChild(fragment);

    this.store.cards.forEach((card, index) => {
      if (!card) return;
      if (index >= start && index < end) return;

      card.remove();
      delete this.store.cards[index];
    });
  }

  getCardWindowRange() {
    const total = this.store.visibleArticles.length;
    const size = Math.max(1, Number(this.config.cardWindow?.size) || 10);
    const keepBehind = Math.max(0, Number(this.config.cardWindow?.keepBehind) || 0);
    const maxStart = Math.max(0, total - size);
    const start = Math.min(Math.max(0, this.store.activeIndex - keepBehind), maxStart);
    const end = Math.min(total, start + size);

    return { start, end };
  }
}
