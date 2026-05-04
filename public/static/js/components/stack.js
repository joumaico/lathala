"use strict";

/* ==========================================================
   CARD STACK AND SWIPE CONTROLLER
========================================================== */
class CardStackController {
  constructor(config, domRegistry, store, feedChrome, readButton, callbacks = {}) {
    this.config = config;
    this.domRegistry = domRegistry;
    this.store = store;
    this.feedChrome = feedChrome;
    this.readButton = readButton;
    this.callbacks = callbacks;
    this.attachedCards = new WeakSet();
    this.styleCache = new WeakMap();
    this.chromeRafId = null;
    this.dragRun = 0;
    this.activeDragRun = 0;
  }

  apply(instant = false) {
    this.store.cards.forEach((card, index) => {
      if (!this.isUsableCard(card)) {
        if (card && !card.isConnected) delete this.store.cards[index];
        return;
      }

      const offset = index - this.store.activeIndex;
      const outOfRange = offset < -1 || offset > 2;
      const shouldAnimate = !instant && !outOfRange;

      // Leave compositor promotion off while idle. It is enabled only for
      // the card currently being dragged or flying out.
      card.style.willChange = "auto";
      card.style.transition = shouldAnimate ? `transform ${this.config.animation.stackMs}ms cubic-bezier(.25,.46,.45,.94), opacity ${this.config.animation.stackMs}ms ease` : "none";

      if (offset === 0) this.applyStyle(card, this.config.stack.active);
      else if (offset === 1) this.applyStyle(card, this.config.stack.next);
      else if (offset === -1) this.applyStyle(card, this.config.stack.previous);
      else this.applyStyle(card, this.config.stack.hidden);

      if (offset === 0) this.attachDrag(card);
    });

    this.readButton.update();
    this.feedChrome.updateSwipeHint();
  }

  revealActiveCard() {
    const card = this.callbacks.ensureCardAtIndex?.(this.store.activeIndex) || this.store.cards[this.store.activeIndex];
    if (!this.isUsableCard(card)) return;

    this.store.revealRun += 1;
    const currentReveal = this.store.revealRun;
    const currentStack = this.store.stackRun;

    clearTimeout(this.store.revealTimerId);
    this.store.revealTimerId = null;

    this.store.cards.forEach((item, index) => {
      if (!this.isUsableCard(item)) return;
      item.style.transition = "none";

      if (index === this.store.activeIndex) {
        this.setCardStyle(item, "translate3d(0,14px,0) scale(0.98)", "0", "10", "auto");
      } else {
        this.applyStyle(item, this.config.stack.hidden);
      }
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentReveal !== this.store.revealRun || currentStack !== this.store.stackRun || !this.isUsableCard(card)) return;

        card.style.transition = `transform ${this.config.animation.revealMs}ms cubic-bezier(.25,.46,.45,.94), opacity ${this.config.animation.revealMs}ms ease`;
        this.applyStyle(card, this.config.stack.active);
      });
    });

    this.store.revealTimerId = setTimeout(() => {
      if (currentReveal === this.store.revealRun && currentStack === this.store.stackRun) this.apply(true);
    }, this.config.animation.revealMs + 30);
  }

  attachDrag(card) {
    if (this.attachedCards.has(card)) return;
    this.attachedCards.add(card);

    const drag = this.createDragState();

    if (this.shouldUseTouchEvents()) {
      card.addEventListener("touchstart", (event) => this.handleDragStart(event, card, drag), { passive: true });
      card.addEventListener("touchmove", (event) => this.handleDragMove(event, card, drag), { passive: false });
      card.addEventListener("touchend", () => this.handleDragEnd(card, drag), { passive: true });
      card.addEventListener("touchcancel", () => this.handleDragEnd(card, drag), { passive: true });
      return;
    }

    if (window.PointerEvent) {
      card.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        drag.pointerId = event.pointerId;
        try {
          card.setPointerCapture?.(event.pointerId);
        } catch (_) {
          // Ignore browsers that reject stale capture requests.
        }
        this.handleDragStart(event, card, drag);
      });

      const movePointerDrag = (event) => {
        if (drag.pointerId !== event.pointerId) return;
        this.handleDragMove(event, card, drag);
      };

      card.addEventListener("pointermove", movePointerDrag, { passive: false });

      const finishPointerDrag = (event) => {
        if (drag.pointerId !== event.pointerId) return;
        try {
          card.releasePointerCapture?.(event.pointerId);
        } catch (_) {
          // Ignore stale pointer-capture releases.
        }
        drag.pointerId = null;
        this.handleDragEnd(card, drag);
      };

      card.addEventListener("pointerup", finishPointerDrag);
      card.addEventListener("pointercancel", finishPointerDrag);
      return;
    }

    card.addEventListener("touchstart", (event) => this.handleDragStart(event, card, drag), { passive: true });
    card.addEventListener("touchmove", (event) => this.handleDragMove(event, card, drag), { passive: false });
    card.addEventListener("touchend", () => this.handleDragEnd(card, drag), { passive: true });
    card.addEventListener("touchcancel", () => this.handleDragEnd(card, drag), { passive: true });
  }

  shouldUseTouchEvents() {
    return "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
  }

  createDragState() {
    return {
      startX: 0,
      startY: 0,
      x: 0,
      visualX: 0,
      lastX: 0,
      lastTime: 0,
      velocityX: 0,
      rafId: null,
      isLive: false,
      isDraggingHorizontally: false,
      direction: null,
      nextCard: null,
      previousCard: null,
      pointerId: null,
      run: 0,
      lastRenderedX: null,
      canGoNext: false,
      canGoPrevious: false,
      wantsNext: false,
      wantsPrevious: false,
      isDeadEnd: false,
      peekSide: null,
    };
  }

  handleDragStart(event, card, drag) {
    if (!this.store.isViewportAllowed || !this.isUsableCard(card)) return;

    const point = this.getGesturePoint(event);
    if (!point) return;

    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }

    drag.startX = point.clientX;
    drag.startY = point.clientY;
    drag.x = 0;
    drag.visualX = 0;
    drag.lastX = 0;
    drag.lastTime = performance.now();
    drag.velocityX = 0;
    drag.lastRenderedX = null;
    drag.run = ++this.dragRun;
    this.activeDragRun = drag.run;
    this.store.isDraggingCard = true;
    drag.isLive = true;
    drag.isDraggingHorizontally = false;
    drag.direction = null;
    drag.nextCard = this.store.cards[this.store.activeIndex + 1] ?? null;
    drag.previousCard = this.store.cards[this.store.activeIndex - 1] ?? null;
    drag.canGoNext = false;
    drag.canGoPrevious = false;
    drag.wantsNext = false;
    drag.wantsPrevious = false;
    drag.isDeadEnd = false;
    drag.peekSide = null;

    card.style.transition = "none";

  }

  handleDragMove(event, card, drag) {
    if (!drag.isLive || !this.isUsableCard(card)) return;

    const point = this.getGesturePoint(event);
    if (!point) return;

    const dx = point.clientX - drag.startX;
    const dy = point.clientY - drag.startY;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastTime);
    drag.velocityX = (dx - drag.lastX) / dt;
    drag.lastX = dx;
    drag.lastTime = now;

    if (!drag.direction && (Math.abs(dx) > this.config.gesture.directionLockPx || Math.abs(dy) > this.config.gesture.directionLockPx)) {
      drag.direction = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
    }

    if (drag.direction !== "horizontal") return;
    if (event.cancelable) event.preventDefault();

    this.startHorizontalDrag(card, drag);

    drag.canGoNext = this.store.activeIndex < this.store.visibleArticles.length - 1;
    drag.canGoPrevious = this.store.activeIndex > 0;
    drag.wantsNext = dx < 0;
    drag.wantsPrevious = dx > 0;
    drag.isDeadEnd = (drag.wantsNext && !drag.canGoNext) || (drag.wantsPrevious && !drag.canGoPrevious);
    this.updatePeekCardForDirection(drag);
    drag.x = drag.isDeadEnd ? dx * this.config.gesture.dragResistance : dx;

    this.scheduleDragFrame(card, drag);
  }

  handleDragEnd(card, drag) {
    if (!drag.isLive) return;
    if (!this.isUsableCard(card)) {
      drag.isLive = false;
      this.finishHorizontalDrag(card, drag);
      return;
    }

    drag.isLive = false;

    if (drag.direction !== "horizontal") {
      drag.direction = null;
      this.finishHorizontalDrag(card, drag);
      return;
    }

    this.flushDragFrame(card, drag);
    drag.direction = null;

    const canGoNext = this.store.activeIndex < this.store.visibleArticles.length - 1;
    const canGoPrevious = this.store.activeIndex > 0;

    const velocityThreshold = Number(this.config.gesture.velocitySwipeThreshold) || 0.45;
    const flickedNext = drag.velocityX < -velocityThreshold;
    const flickedPrevious = drag.velocityX > velocityThreshold;

    if ((drag.x < -this.config.gesture.swipeThreshold || flickedNext) && canGoNext) this.flyOff(card, "next", drag);
    else if ((drag.x > this.config.gesture.swipeThreshold || flickedPrevious) && canGoPrevious) this.flyOff(card, "previous", drag);
    else this.springBack(card, drag);
  }

  getGesturePoint(event) {
    const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
    const latestEvent = coalescedEvents?.length ? coalescedEvents[coalescedEvents.length - 1] : event;
    const touch = latestEvent.touches?.[0] || latestEvent.changedTouches?.[0];

    if (touch) return { clientX: touch.clientX, clientY: touch.clientY };
    if (typeof latestEvent.clientX === "number" && typeof latestEvent.clientY === "number") return { clientX: latestEvent.clientX, clientY: latestEvent.clientY };
    return null;
  }

  startHorizontalDrag(card, drag) {
    if (drag.isDraggingHorizontally || !this.isUsableCard(card)) return;

    drag.isDraggingHorizontally = true;
    this.domRegistry.nodes.app?.classList.add(this.config.classes.swiping);
    card.classList.add(this.config.classes.dragging);
    card.style.willChange = "transform";
  }

  finishHorizontalDrag(card, drag) {
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }

    drag.isDraggingHorizontally = false;
    drag.visualX = drag.x;
    if (drag.run === this.activeDragRun) this.store.isDraggingCard = false;
    this.domRegistry.nodes.app?.classList.remove(this.config.classes.swiping);
    card?.classList?.remove(this.config.classes.dragging);
    if (card?.style) card.style.willChange = "auto";

    drag.peekSide = null;
    this.restoreIdlePeekCards();
  }

  cleanupDetachedCard(card, drag) {
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }

    drag.isDraggingHorizontally = false;
    card?.classList?.remove(this.config.classes.dragging);
    if (card?.style) card.style.willChange = "auto";
  }

  scheduleDragFrame(card, drag) {
    if (drag.rafId) return;

    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = null;
      this.renderSmoothedDragFrame(card, drag);
    });
  }

  flushDragFrame(card, drag) {
    if (!this.isUsableCard(card)) return;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }

    drag.visualX = drag.x;
    this.renderDragFrame(card, drag, drag.visualX);
  }

  renderSmoothedDragFrame(card, drag) {
    if (!this.isUsableCard(card)) return;

    // Follow the finger exactly on mobile. The previous easing loop looked
    // smooth on desktop, but felt delayed on slower phone GPUs.
    drag.visualX = drag.x;
    this.renderDragFrame(card, drag, drag.visualX);
  }

  renderDragFrame(card, drag, x) {
    if (!this.isUsableCard(card)) return;

    this.updatePeekCardForDirection(drag);

    const precision = Math.max(1, Number(this.config.gesture.dragFramePrecisionPx) || 1);
    const roundedX = Math.round(x / precision) * precision;
    if (roundedX === drag.lastRenderedX) return;

    drag.lastRenderedX = roundedX;
    card.style.transform = `translate3d(${roundedX}px,0,0)`;
  }

  updatePeekCardForDirection(drag) {
    const peekSide = drag.isDeadEnd ? null : drag.wantsNext && drag.canGoNext ? "next" : drag.wantsPrevious && drag.canGoPrevious ? "previous" : null;
    if (peekSide === drag.peekSide) return;

    drag.peekSide = peekSide;

    // The low-power stack keeps previous/current/next cards in the same flat
    // position. When the active card moves, the card immediately behind it
    // must match the swipe direction. Otherwise the higher z-index sibling can
    // peek through and make images look random during quick reversals.
    this.setPeekCardVisibility(drag.nextCard, peekSide === "next", this.config.stack.next);
    this.setPeekCardVisibility(drag.previousCard, peekSide === "previous", this.config.stack.previous);
  }

  setPeekCardVisibility(card, isVisible, baseStyle) {
    if (!this.isUsableCard(card)) return;

    const visibleZIndex = String(Number(this.config.stack.active.zIndex || 10) - 1);
    const hiddenZIndex = String(Math.max(0, Number(visibleZIndex) - 1));
    const opacity = isVisible ? "1" : "0";
    const zIndex = isVisible ? visibleZIndex : hiddenZIndex;

    this.setCardStyle(card, baseStyle.transform, opacity, zIndex, "none");
  }

  restoreIdlePeekCards(excludedCard = null) {
    const nextCard = this.store.cards[this.store.activeIndex + 1];
    const previousCard = this.store.cards[this.store.activeIndex - 1];

    if (nextCard !== excludedCard && this.isUsableCard(nextCard)) this.applyStyle(nextCard, this.config.stack.next);
    if (previousCard !== excludedCard && this.isUsableCard(previousCard)) this.applyStyle(previousCard, this.config.stack.previous);
  }

  flyOff(card, direction, drag) {
    if (!this.isUsableCard(card)) return;

    const currentStack = this.store.stackRun;
    const currentSwipe = ++this.store.swipeRun;
    const leavingIndex = Number(card.dataset.idx);
    const flyMs = this.getFlyDuration(drag);
    const exitX = direction === "next" ? `-${this.config.gesture.exitDistance}` : this.config.gesture.exitDistance;

    card.style.willChange = "transform";
    card.style.zIndex = "20";
    card.style.transition = `transform ${flyMs}ms cubic-bezier(.55,0,1,.45)`;
    this.setCardStyle(card, `translate3d(${exitX},0,0)`, "1", card.style.zIndex, "none");

    this.store.hasDismissedSwipeHint = true;
    this.store.activeIndex += direction === "next" ? 1 : -1;
    this.ensureFastSwipeBuffer(direction);
    this.callbacks.preloadAroundIndex?.(this.store.activeIndex);

    const newTopCard = this.store.cards[this.store.activeIndex] || this.callbacks.ensureCardAtIndex?.(this.store.activeIndex);
    if (this.isUsableCard(newTopCard)) {
      newTopCard.style.willChange = "auto";
      newTopCard.style.transition = "none";
      this.applyStyle(newTopCard, this.config.stack.active);
      this.attachDrag(newTopCard);
    }

    this.restoreIdlePeekCards(card);
    this.queueChromeUpdate();

    setTimeout(() => {
      const becameActiveAgain = leavingIndex === this.store.activeIndex;

      if (!becameActiveAgain) {
        if (drag.run === this.activeDragRun) this.finishHorizontalDrag(card, drag);
        else this.cleanupDetachedCard(card, drag);

        card.remove();
        if (Number.isInteger(leavingIndex)) delete this.store.cards[leavingIndex];
      } else if (!this.store.isDraggingCard) {
        this.finishHorizontalDrag(card, drag);
      }

      // Ignore stale stack work. Rapid swipes can otherwise queue many
      // apply()/syncCardWindow() calls and stutter the active gesture.
      if (currentStack !== this.store.stackRun || currentSwipe !== this.store.swipeRun || this.store.isDraggingCard) return;

      this.callbacks.syncCardWindow?.();
      this.apply(true);
    }, flyMs + 30);
  }

  ensureFastSwipeBuffer(direction) {
    // Create only the card needed for the next possible flick. Building two or
    // three cards during touchend can block slower mobile CPUs.
    const offsets = direction === "next" ? [0, 1] : [0, -1];

    offsets.forEach((offset) => {
      const index = this.store.activeIndex + offset;
      if (index >= 0 && index < this.store.visibleArticles.length) this.callbacks.ensureCardAtIndex?.(index);
    });
  }

  getFlyDuration(drag) {
    const configured = Number(this.config.animation.flyMs) || 220;
    const minimum = Number(this.config.animation.fastFlyMinMs) || 120;
    const velocity = Math.min(Math.abs(drag.velocityX || 0), 2.4);
    const velocityBoost = velocity / 2.4;
    return Math.round(MathUtil.interpolate(configured, minimum, velocityBoost));
  }

  springBack(card, drag) {
    if (!this.isUsableCard(card)) return;

    const currentStack = this.store.stackRun;
    card.style.transition = `transform ${this.config.animation.springMs}ms cubic-bezier(.25,.46,.45,.94)`;
    card.style.transform = this.config.stack.active.transform;

    setTimeout(() => {
      if (currentStack === this.store.stackRun) this.finishHorizontalDrag(card, drag);
    }, this.config.animation.springMs + 30);
  }

  isUsableCard(card) {
    return Boolean(card && card.style && card.classList && card.isConnected);
  }

  applyStyle(card, style) {
    if (!this.isUsableCard(card)) return;
    this.setCardStyle(card, style.transform, style.opacity, style.zIndex, style.pointerEvents);
  }

  queueChromeUpdate() {
    if (this.chromeRafId) return;

    this.chromeRafId = requestAnimationFrame(() => {
      this.chromeRafId = null;
      this.feedChrome.updateProgress();
      this.readButton.update();
      this.feedChrome.updateSwipeHint();
    });
  }

  setCardStyle(card, transform, opacity, zIndex, pointerEvents) {
    if (!card?.style) return;

    let cache = this.styleCache.get(card);
    if (!cache) {
      cache = {};
      this.styleCache.set(card, cache);
    }

    if (cache.transform !== transform) {
      card.style.transform = transform;
      cache.transform = transform;
    }
    if (cache.opacity !== opacity) {
      card.style.opacity = opacity;
      cache.opacity = opacity;
    }
    if (cache.zIndex !== zIndex) {
      card.style.zIndex = zIndex;
      cache.zIndex = zIndex;
    }
    if (cache.pointerEvents !== pointerEvents) {
      card.style.pointerEvents = pointerEvents;
      cache.pointerEvents = pointerEvents;
    }
  }
}
