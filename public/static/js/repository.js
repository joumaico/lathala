"use strict";

/* ==========================================================
   DATA SERVICE
========================================================== */
class ArticleRepository {
  constructor(config) {
    this.config = config;
    this.imagePreloadCache = new Map();
    this.appConfigPromise = null;
  }

  hasLiveApiKey() {
    const key = this.config.api.anonKey;
    return Boolean(key && !key.includes("PASTE_YOUR_SUPABASE_ANON_KEY_HERE"));
  }

  async fetchArticlesByTag(tag = null) {
    if (!this.hasLiveApiKey()) {
      console.warn("Supabase anon key is not set. Using fallback articles.");
      return this.getFallbackArticles(tag);
    }

    const params = new URLSearchParams();
    if (tag && String(tag).trim()) params.set(this.config.api.tagParam, tag);

    const query = params.toString();
    const endpoint = `${this.config.api.supabaseUrl}/rest/v1/rpc/${this.config.api.rpcName}${query ? `?${query}` : ""}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: this.getSupabaseHeaders(),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${message}`);
    }

    const rows = await response.json();

    if (this.needsComputedPublisherLogo(rows)) {
      await this.loadAppConfig();
    }

    return this.normalizeArticles(rows);
  }

  getSupabaseHeaders() {
    return {
      apikey: this.config.api.anonKey,
      Authorization: `Bearer ${this.config.api.anonKey}`,
      Accept: "application/json",
    };
  }

  async loadAppConfig() {
    if (this.appConfigPromise) return this.appConfigPromise;

    this.appConfigPromise = this.fetchAppConfig().catch((error) => {
      console.warn("Supabase app config request failed:", error);
      return null;
    });

    return this.appConfigPromise;
  }

  async fetchAppConfig() {
    const rpcName = this.config.api.appConfigRpcName;
    if (!rpcName) return null;

    const endpoint = `${this.config.api.supabaseUrl}/rest/v1/rpc/${rpcName}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: this.getSupabaseHeaders(),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Supabase config request failed (${response.status}): ${message}`);
    }

    const payload = await response.json();
    const appConfig = this.unwrapAppConfig(payload);
    this.applyPublisherLogoConfig(appConfig);
    return appConfig;
  }

  unwrapAppConfig(payload) {
    const value = Array.isArray(payload) ? payload[0] : payload;
    if (!value || typeof value !== "object") return {};
    return value[this.config.api.appConfigRpcName] && typeof value[this.config.api.appConfigRpcName] === "object" ? value[this.config.api.appConfigRpcName] : value;
  }

  applyPublisherLogoConfig(appConfig) {
    if (!appConfig || typeof appConfig !== "object") return;

    const baseUrl = Urls.safe(appConfig.PUBLISHER_LOGO_BASE_URL, "").replace(/\/+$/, "");
    const extension = this.cleanPublisherLogoExtension(appConfig.PUBLISHER_LOGO_BASE_EXT);

    if (baseUrl) this.config.assets.publisherLogoBaseUrl = baseUrl;
    if (extension) this.config.assets.publisherLogoBaseExt = extension;
  }

  cleanPublisherLogoExtension(value) {
    return String(value ?? "")
      .trim()
      .replace(/^\.+/, "");
  }

  getFallbackArticles(tag = null) {
    const articles = this.normalizeArticles(this.config.fallbackArticles);
    return tag ? articles.filter((article) => article.tag === tag) : articles;
  }

  normalizeArticles(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => this.normalizeArticle(row)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  normalizeArticle(row) {
    const item = this.unwrapRpcRow(row) ?? {};
    const url = Urls.safe(item.url, "#");
    const publisher = item.publisher && typeof item.publisher === "object" ? item.publisher : {};

    const publisherDomain = String(publisher.domain || item.publisher_domain || "");

    return {
      url,
      tag: String(item.tag || this.config.messages.uncategorized),
      date: String(item.date || ""),
      image: Urls.safe(item.image, this.config.assets.defaultImage),
      title: String(item.title || this.config.messages.untitledArticle),
      author: String(item.author || ""),
      bullets: this.normalizeBullets(item.bullets),
      publisher: {
        id: publisher.id ?? item.publisher_id ?? null,
        domain: publisherDomain,
        name: String(publisher.name || item.publisher_name || publisherDomain || this.getPublisherName(url)),
        url: Urls.safe(publisher.url || item.publisher_url, "#"),
        logo: Urls.safe(publisher.logo || item.publisher_logo, ""),
      },
    };
  }

  unwrapRpcRow(row) {
    const rpcName = this.config.api.rpcName;
    return row && typeof row === "object" && rpcName in row ? row[rpcName] : row;
  }

  needsComputedPublisherLogo(rows) {
    return (Array.isArray(rows) ? rows : []).some((row) => {
      const item = this.unwrapRpcRow(row) ?? {};
      const publisher = item.publisher && typeof item.publisher === "object" ? item.publisher : {};
      const domain = String(publisher.domain || item.publisher_domain || "").trim();
      const logo = Urls.safe(publisher.logo || item.publisher_logo, "");

      return domain && !logo;
    });
  }

  normalizeBullets(bullets) {
    if (!Array.isArray(bullets)) return [this.config.messages.defaultBullet];

    const cleanBullets = bullets.map((bullet) => String(bullet).trim()).filter(Boolean);
    return cleanBullets.length ? cleanBullets : [this.config.messages.defaultBullet];
  }

  getPublisherName(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return this.config.messages.defaultPublisherName;
    }
  }

  getPublisherLogoUrl(publisher) {
    const directLogo = Urls.safe(publisher?.logo, "");
    if (directLogo) return directLogo;

    const computedLogo = this.getComputedPublisherLogoUrl(publisher?.domain);
    return computedLogo || this.config.assets.defaultPublisherLogo;
  }

  getComputedPublisherLogoUrl(domain) {
    const cleanDomain = this.cleanPublisherDomain(domain);
    const baseUrl = Urls.safe(this.config.assets.publisherLogoBaseUrl, "").replace(/\/+$/, "");
    const extension = this.cleanPublisherLogoExtension(this.config.assets.publisherLogoBaseExt);

    if (!cleanDomain || !baseUrl || !extension) return "";
    return `${baseUrl}/${cleanDomain}.${extension}`;
  }

  cleanPublisherDomain(domain) {
    return String(domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .replace(/[^a-z0-9.-]/g, "");
  }

  preloadArticleImages(articles) {
    const urls = this.getPreloadImageUrls(articles);
    return Promise.allSettled(urls.map((url) => this.preloadImage(url)));
  }

  getPreloadImageUrls(articles) {
    const urls = new Set([this.config.assets.defaultImage, this.config.assets.defaultPublisherLogo]);

    articles.forEach((article) => {
      urls.add(Urls.safe(article.image, this.config.assets.defaultImage));
      urls.add(Urls.safe(this.getPublisherLogoUrl(article.publisher), this.config.assets.defaultPublisherLogo));
    });

    return Array.from(urls).filter(Boolean);
  }

  preloadImage(url) {
    if (this.imagePreloadCache.has(url)) return this.imagePreloadCache.get(url).promise;

    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";

    const promise = new Promise((resolve) => {
      // Do not force image.decode() here. Decoding many images ahead burns CPU
      // on mobile and can fight the swipe animation. Let the browser decode
      // asynchronously when it is ready.
      image.onload = () => resolve(url);
      image.onerror = () => resolve(url);
    });

    this.imagePreloadCache.set(url, { image, promise });
    image.src = url;
    return promise;
  }
}
