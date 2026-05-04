"use strict";

const PUBLISHER_VISIBLE_SOURCE_LIMIT = 3;
const SOURCE_LINK_PREVIEW_LIMIT = 40;

const state = {
  publishers: [],
  settings: {},
  defaults: {},
  sourcePreviewLimit: PUBLISHER_VISIBLE_SOURCE_LIMIT,
  terminalToastTaskId: "",
};

const $ = (selector) => document.querySelector(selector);

const nodes = {
  settingsForm: $("#settings-form"),
  settingsSave: $("#settings-save"),
  publisherList: $("#publisher-list"),
  publisherForm: $("#publisher-form"),
  publisherId: $("#publisher-id"),
  publisherName: $("#publisher-name"),
  publisherDomain: $("#publisher-domain"),
  publisherSources: $("#publisher-sources"),
  sourceUrl: $("#source-url"),
  sourceLinks: $("#source-links"),
  articleUrl: $("#article-url"),
  articleOutput: $("#article-output"),
  runOutput: $("#run-output"),
  runCancel: $("#run-cancel"),
  toast: $("#toast"),
};

boot();

function boot() {
  bindEvents();
  refreshAll();
}

function bindEvents() {
  nodes.settingsSave.addEventListener("click", saveSettings);
  $("#source-test").addEventListener("click", testSource);
  $("#article-test").addEventListener("click", testArticle);
  $("#publisher-new").addEventListener("click", () => openPublisherForm());
  $("#publisher-cancel").addEventListener("click", closePublisherForm);
  nodes.runCancel.addEventListener("click", cancelWorkflow);
  nodes.publisherForm.addEventListener("submit", savePublisher);
  nodes.publisherList.addEventListener("click", onPublisherAction);

  document.querySelectorAll("[data-run]").forEach((button) => {
    button.addEventListener("click", () => runWorkflow(button.dataset.run));
  });
  pollWorkflowStatus();
}

async function refreshAll() {
  await Promise.allSettled([loadSettings(), loadPublishers()]);
}

async function requestJson(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers, cache: "no-store" });
  } catch (error) {
    throw new Error(`Could not reach the local Flask control server. Open this page from Flask, for example http://127.0.0.1:5001/control, then try again. Browser message: ${error.message}`);
  }

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("The server returned a non-JSON response.");
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }

  return payload;
}

async function loadSettings() {
  try {
    const data = await requestJson("/api/control/settings");
    state.settings = data.settings || {};
    state.defaults = data.defaults || {};
    renderSettings();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSettings() {
  const labels = {
    GEMINI_MODEL_ID: "Gemini model ID",
    GEMINI_LINK_BATCH_SIZE: "Gemini link batch size",
    GEMINI_ARTICLE_BATCH_SIZE: "Gemini article batch size",
    PUBLISHER_LOGO_BASE_URL: "Publisher logo base URL",
    PUBLISHER_LOGO_BASE_EXT: "Publisher logo file extension",
    SCRAPE_CONCURRENCY: "Scrape concurrency",
    HTTP_CONCURRENCY: "HTTP validation concurrency",
    SCRAPE_TIMEOUT_SEC: "Scrape timeout seconds",
    HTTP_TIMEOUT_SEC: "HTTP validation timeout seconds",
    RENDER_WAIT_MS: "Render wait milliseconds",
    BATCH_SIZE: "Batch size",
    REQUEST_DELAY_SEC: "Request delay seconds",
    MAX_AI_RETRIES: "Max AI retries",
    RETRY_BACKOFF_SEC: "Retry backoff seconds",
  };
  const fragment = document.createDocumentFragment();

  Object.entries(labels).forEach(([key, label]) => {
    const value = state.settings[key] ?? state.defaults[key] ?? "";
    const textKeys = ["GEMINI_MODEL_ID", "PUBLISHER_LOGO_BASE_URL", "PUBLISHER_LOGO_BASE_EXT"];
    const inputType = textKeys.includes(key) ? "text" : "number";
    const step = key.includes("SEC") || key.includes("BACKOFF") || key.includes("DELAY") ? "0.1" : "1";
    const field = document.createElement("label");
    const labelText = document.createElement("span");
    const input = document.createElement("input");

    field.className = "field";
    labelText.textContent = label;
    input.name = key;
    input.type = inputType;
    input.step = step;
    if (inputType === "number") input.min = step === "1" ? "1" : "0";
    input.value = value;

    field.append(labelText, input);
    fragment.append(field);
  });

  nodes.settingsForm.replaceChildren(fragment);
}

async function saveSettings() {
  const payload = Object.fromEntries(new FormData(nodes.settingsForm));

  Object.keys(payload).forEach((key) => {
    if (!["GEMINI_MODEL_ID", "PUBLISHER_LOGO_BASE_URL", "PUBLISHER_LOGO_BASE_EXT"].includes(key)) payload[key] = Number(payload[key]);
  });

  await withBusy(nodes.settingsSave, async () => {
    const data = await requestJson("/api/control/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.settings = data.settings || {};
    renderSettings();
    toast("Settings saved.");
  });
}

async function loadPublishers() {
  try {
    const data = await requestJson("/api/control/publishers");
    state.publishers = data.publishers || [];
    state.sourcePreviewLimit = data.source_preview_limit || PUBLISHER_VISIBLE_SOURCE_LIMIT;
    renderPublishers();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderPublishers() {
  if (!state.publishers.length) {
    const empty = document.createElement("div");
    empty.className = "link-list empty";
    empty.textContent = "No publishers yet. Create one above.";
    nodes.publisherList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  state.publishers.forEach((publisher) => {
    const sources = Array.isArray(publisher.sources) ? publisher.sources : [];
    const totalSourceCount = Number(publisher.source_count ?? sources.length);
    const card = document.createElement("section");
    const body = document.createElement("div");
    const title = document.createElement("h3");
    const meta = document.createElement("p");
    const sourceStack = document.createElement("div");
    const actions = document.createElement("div");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    card.className = "publisher-card";
    card.dataset.id = publisher.id;
    sourceStack.className = "source-stack";
    actions.className = "card-actions";
    editButton.className = "icon-btn";
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.dataset.id = publisher.id;
    editButton.textContent = "Edit";
    deleteButton.className = "icon-btn danger";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = publisher.id;
    deleteButton.textContent = "Delete";

    title.textContent = publisher.name || "Untitled publisher";
    meta.textContent = `${publisher.domain || "No domain"}`;

    if (sources.length) {
      sources.slice(0, state.sourcePreviewLimit).forEach((source) => {
        const pill = document.createElement("span");
        pill.className = "source-pill";
        pill.title = source.url || "";
        pill.textContent = source.url || "";
        sourceStack.append(pill);
      });
      const hiddenCount = Math.max(0, totalSourceCount - Math.min(sources.length, state.sourcePreviewLimit));
      if (hiddenCount) {
        const more = document.createElement("span");
        more.className = "source-pill muted";
        more.textContent = `+${hiddenCount} more`;
        sourceStack.append(more);
      }
    } else {
      const empty = document.createElement("span");
      empty.className = "source-pill";
      empty.textContent = "No source links";
      sourceStack.append(empty);
    }

    body.append(title, meta, sourceStack);
    actions.append(editButton, deleteButton);
    card.append(body, actions);
    fragment.append(card);
  });

  nodes.publisherList.replaceChildren(fragment);
}

function onPublisherAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !nodes.publisherList.contains(button)) return;

  const id = Number(button.dataset.id);
  if (!id) return;

  if (button.dataset.action === "edit") editPublisher(id, button);
  if (button.dataset.action === "delete") deletePublisher(id, button);
}

function openPublisherForm(publisher = null) {
  nodes.publisherForm.classList.remove("hidden");
  nodes.publisherId.value = publisher?.id || "";
  nodes.publisherName.value = publisher?.name || "";
  nodes.publisherDomain.value = publisher?.domain || "";
  nodes.publisherSources.value = (publisher?.sources || []).map((source) => source.url).join("\n");
  nodes.publisherName.focus();
}

function closePublisherForm() {
  nodes.publisherForm.classList.add("hidden");
  nodes.publisherForm.reset();
  nodes.publisherId.value = "";
}

async function editPublisher(id, button) {
  await withBusy(button, async () => {
    const data = await requestJson(`/api/control/publishers/${id}`);
    openPublisherForm(data.publisher || null);
  });
}

async function savePublisher(event) {
  event.preventDefault();
  const id = nodes.publisherId.value;
  const payload = {
    name: nodes.publisherName.value.trim(),
    domain: nodes.publisherDomain.value.trim(),
    source_urls: nodes.publisherSources.value
      .split(/\n+/)
      .map((url) => url.trim())
      .filter(Boolean),
  };
  const url = id ? `/api/control/publishers/${id}` : "/api/control/publishers";
  const method = id ? "PUT" : "POST";

  await withBusy($("#publisher-save"), async () => {
    await requestJson(url, { method, body: JSON.stringify(payload) });
    closePublisherForm();
    await loadPublishers();
    toast(id ? "Publisher updated." : "Publisher created.");
  });
}

async function deletePublisher(id, button) {
  const publisher = state.publishers.find((item) => Number(item.id) === id);
  const ok = confirm(`Delete ${publisher?.name || "this publisher"} and its source links?`);
  if (!ok) return;

  await withBusy(button, async () => {
    await requestJson(`/api/control/publishers/${id}`, { method: "DELETE" });
    await loadPublishers();
    toast("Publisher deleted.");
  });
}

async function testSource() {
  const button = $("#source-test");
  const url = nodes.sourceUrl.value.trim();
  if (!url) return toast("Enter a source URL first.", true);

  nodes.sourceLinks.className = "link-list empty";
  nodes.sourceLinks.textContent = "Extracting links...";

  await withBusy(button, async () => {
    const data = await requestJson("/api/control/test/source", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    renderSourceLinks(data.article_urls || [], data.count || 0, Boolean(data.truncated));
    toast(`Found ${data.count || 0} article link(s).`);
  });
}

function renderSourceLinks(urls, totalCount = urls.length, truncated = false) {
  const visibleUrls = urls.slice(0, SOURCE_LINK_PREVIEW_LIMIT);

  if (!visibleUrls.length) {
    nodes.sourceLinks.className = "link-list empty";
    nodes.sourceLinks.textContent = "No article links found.";
    return;
  }

  const fragment = document.createDocumentFragment();
  const hiddenCount = Math.max(0, totalCount - visibleUrls.length);

  if (truncated || hiddenCount) {
    const note = document.createElement("div");
    note.className = "list-note";
    note.textContent = `Showing first ${visibleUrls.length} of ${totalCount} extracted links to keep the browser light.`;
    fragment.append(note);
  }

  visibleUrls.forEach((url) => {
    const link = document.createElement("a");
    link.className = "link-chip";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url;
    fragment.append(link);
  });

  nodes.sourceLinks.className = "link-list";
  nodes.sourceLinks.replaceChildren(fragment);
}

async function testArticle() {
  const button = $("#article-test");
  const url = nodes.articleUrl.value.trim();
  if (!url) return toast("Enter an article URL first.", true);

  nodes.articleOutput.textContent = "Generating article JSON...";

  await withBusy(button, async () => {
    const data = await requestJson("/api/control/test/article", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    nodes.articleOutput.textContent = JSON.stringify(data.data, null, 2);
    toast("Article JSON generated.");
  });
}

async function runWorkflow(name) {
  setRunButtonsDisabled(true);
  nodes.runCancel.classList.remove("hidden");
  nodes.runOutput.textContent = `Starting ${name}...`;

  try {
    const data = await requestJson(`/api/control/run/${name}`, { method: "POST", body: JSON.stringify({}) });
    renderWorkflowTask(data.task);
    toast(`${name} started.`);
    scheduleWorkflowPoll();
  } catch (error) {
    setRunButtonsDisabled(false);
    nodes.runCancel.classList.add("hidden");
    nodes.runOutput.textContent = error.message;
    toast(error.message, true);
  }
}

async function cancelWorkflow() {
  nodes.runCancel.disabled = true;
  nodes.runCancel.textContent = "Cancelling...";

  try {
    const data = await requestJson("/api/control/run/cancel", { method: "POST", body: JSON.stringify({}) });
    renderWorkflowTask(data.task);
    toast("Cancellation requested.");
    scheduleWorkflowPoll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    nodes.runCancel.disabled = false;
    nodes.runCancel.textContent = "Cancel";
  }
}

async function pollWorkflowStatus() {
  try {
    const data = await requestJson("/api/control/run/status");
    renderWorkflowTask(data.task);
    if (data.task && ["running", "cancelling"].includes(data.task.status)) scheduleWorkflowPoll();
  } catch {
    setRunButtonsDisabled(false);
    nodes.runCancel.classList.add("hidden");
  }
}

function scheduleWorkflowPoll() {
  clearTimeout(pollWorkflowStatus.timer);
  pollWorkflowStatus.timer = setTimeout(pollWorkflowStatus, 1200);
}

function renderWorkflowTask(task) {
  if (!task) {
    setRunButtonsDisabled(false);
    nodes.runCancel.classList.add("hidden");
    return;
  }

  const isActive = ["running", "cancelling"].includes(task.status);
  setRunButtonsDisabled(isActive);
  nodes.runCancel.classList.toggle("hidden", !isActive);

  const lines = [
    `${task.name}: ${task.status}`,
    task.message || "",
    ...(task.logs || []).slice(-12),
  ].filter(Boolean);

  if (task.result) lines.push("", JSON.stringify(task.result, null, 2));
  if (task.error) lines.push("", task.error);

  nodes.runOutput.textContent = lines.join("\n");

  if (!isActive) {
    clearTimeout(pollWorkflowStatus.timer);
    if (state.terminalToastTaskId !== task.id) {
      state.terminalToastTaskId = task.id;
      if (task.status === "finished") toast(`${task.name} finished.`);
      if (task.status === "cancelled") toast(`${task.name} cancelled.`);
      if (task.status === "error") toast(task.error || `${task.name} failed.`, true);
    }
  }
}

function setRunButtonsDisabled(disabled) {
  document.querySelectorAll("[data-run]").forEach((button) => {
    button.disabled = disabled;
  });
}

async function withBusy(button, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Working...";
  try {
    await fn();
  } catch (error) {
    toast(error.message, true);
    if (nodes.runOutput.textContent.includes("Running")) nodes.runOutput.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function toast(message, isError = false) {
  nodes.toast.textContent = message;
  nodes.toast.classList.toggle("error", Boolean(isError));
  nodes.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => nodes.toast.classList.remove("show"), 3200);
}
