"use strict";

/* ==========================================================
   CAROUSEL COMPONENT
========================================================== */
class CarouselComponent {
  constructor(config, card, total) {
    this.config = config;
    this.card = card;
    this.total = total;
    this.current = 0;
  }

  bind() {
    if (this.total <= 1) return;

    const track = Dom.$(this.config.selectors.carouselTrack, this.card);
    const pips = Dom.all(this.config.selectors.carouselPip, this.card);
    if (!track || !pips.length) return;

    track.addEventListener(
      "scroll",
      () => {
        const itemHeight = track.clientHeight;
        if (!itemHeight) return;

        const nextIndex = Math.round(track.scrollTop / itemHeight);
        if (nextIndex >= 0 && nextIndex < this.total) this.activatePip(pips, nextIndex);
      },
      { passive: true },
    );
  }

  activatePip(pips, nextIndex) {
    if (nextIndex === this.current) return;

    const oldPip = pips[this.current];
    const newPip = pips[nextIndex];
    if (!oldPip || !newPip) return;

    oldPip.classList.remove(this.config.classes.active);
    oldPip.classList.add(this.config.classes.leaving);
    setTimeout(() => oldPip.classList.remove(this.config.classes.leaving), this.config.animation.pipLeaveCleanupMs);

    newPip.classList.add(this.config.classes.arriving);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        newPip.classList.add(this.config.classes.active);
        setTimeout(() => newPip.classList.remove(this.config.classes.arriving), this.config.animation.pipArriveCleanupMs);
      });
    });

    this.current = nextIndex;
  }
}
