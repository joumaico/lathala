"use strict";

const start = () => {
  new AppController(APP_CONFIG).boot();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
