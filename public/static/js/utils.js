"use strict";

/* ==========================================================
   SHARED HELPERS
========================================================== */
const Dom = {
  $(selector, root = document) {
    return root.querySelector(selector);
  },

  all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  },
};

const Text = {
  escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  toTitleCase(str) {
    return str.replace(/\b\w/g, (char) => char.toUpperCase());
  },

  twoLineTitle(title) {
    const text = String(title ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (text.length < 2) return Text.escape(text);

    let bestIndex = -1;
    let smallestDiff = Infinity;

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== " ") continue;

      const firstLine = text.slice(0, index);
      const secondLine = text.slice(index + 1);
      if (secondLine.length <= firstLine.length) continue;

      const diff = secondLine.length - firstLine.length;
      if (diff < smallestDiff) {
        smallestDiff = diff;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      const firstLength = Math.max(1, Math.floor((text.length - 1) / 2));
      return `${Text.escape(text.slice(0, firstLength))}<br>${Text.escape(text.slice(firstLength))}`;
    }

    return `${Text.escape(text.slice(0, bestIndex))}<br>${Text.escape(text.slice(bestIndex + 1))}`;
  },
};

const Urls = {
  safe(value, fallback = "") {
    const text = String(value ?? "").trim();

    if (!text || text === "#") return fallback;
    if (/^(static\/|\.\/|\/)/.test(text)) return text;

    try {
      const url = new URL(text, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
    } catch (_) {
      return fallback;
    }
  },

  css(value) {
    return String(value).replace(/"/g, "%22");
  },
};

const Time = {
  format(value) {
    if (!value) return "";
    if (window.timeago && typeof window.timeago.format === "function") return window.timeago.format(value);
    return value;
  },

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  waitForPageLoad() {
    if (document.readyState === "complete") return Promise.resolve();
    return new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  },
};

const MathUtil = {
  interpolate(from, to, progress) {
    return from + (to - from) * progress;
  },
};
