"use strict";

/* ==========================================================
   ARTICLE CARD FACTORY
========================================================== */
class ArticleCardFactory {
  constructor(config, repository) {
    this.config = config;
    this.repository = repository;
  }

  create(article, index) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.idx = String(index);
    card.innerHTML = this.renderMarkup(article);

    const image = Dom.$(this.config.selectors.cardImage, card);
    const logo = Dom.$(this.config.selectors.cardLogo, card);

    if (image) image.style.backgroundImage = `url("${Urls.css(Urls.safe(article.image, this.config.assets.defaultImage))}")`;
    if (logo) logo.style.backgroundImage = `url("${Urls.css(this.repository.getPublisherLogoUrl(article.publisher))}")`;

    new CarouselComponent(this.config, card, article.bullets.length).bind();
    return card;
  }

  renderMarkup(article) {
    return `
      <div class="card__image">
        <div class="card__publisher">
          <div class="card__publisher-left">
            <div class="card__logo"></div>
            <div class="card__meta">
              <span class="card__pub-name">${Text.escape(article.publisher.name)}</span>
              <span class="card__pub-date"><i class="fa-solid fa-clock"></i>${Text.escape(Time.format(article.date))}</span>
            </div>
          </div>
          <div class="card__tag">${Text.escape(article.tag)}</div>
        </div>
      </div>

      <div class="card__content">
        <h2 class="card__title">${Text.twoLineTitle(Text.toTitleCase(article.title))}</h2>

        <div class="card__subtitle">
          <div class="card__divider"></div>
          <i class="fa-solid fa-user-pen"></i>
          ${this.renderAuthors(article)}
        </div>

        <div class="carousel">
          <div class="carousel__dot-track">
            ${this.renderPips(article.bullets.length)}
          </div>
          <div class="carousel__track">
            ${this.renderBullets(article.bullets)}
          </div>
        </div>
      </div>
    `;
  }

  renderAuthors(article) {
    const authorName = article.author || article.publisher?.name || "";

    const separators = [",", " and "];

    const authors = separators
      .reduce(
        (names, separator) => {
          return names.flatMap((name) => name.split(separator));
        },
        [authorName.toLowerCase()],
      )
      .map((name) => name.trim())
      .filter(Boolean);

    if (!authors.length) return "";

    return `
      <div class="card__author">
        <span>${Text.escape(authors[0])}</span>
        ${authors.length > 1 ? `<span>+&nbsp;${authors.length - 1}</span>` : ""}
      </div>
    `;
  }

  renderPips(total) {
    return Array.from({ length: total }, (_, index) => `<div class="carousel__dot-pip${index === 0 ? ` ${this.config.classes.active}` : ""}"></div>`).join("");
  }

  renderBullets(bullets) {
    return bullets
      .map(
        (bullet) => `
          <div class="carousel__item">
            <p class="carousel__text">${Text.escape(bullet)}</p>
          </div>
        `,
      )
      .join("");
  }
}
