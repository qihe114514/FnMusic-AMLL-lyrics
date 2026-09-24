const defaults = {
  fontSize: 28,
  lyricSizePreset: "medium",
  fontFamily: "Microsoft YaHei",
  fontWeight: 600,
  letterSpacing: "normal",
  blur: true,
  scale: true,
  spring: true,
  showTranslation: true,
  showRomanization: true,
  swapTranslationRomanization: false,
  wordFadeWidth: 0.5,
  offset: 0,
  backgroundRenderer: "mesh",
  backgroundRenderScale: 1,
  backgroundFps: 60,
  backgroundStaticMode: false,
  fftFrom: 80,
  fftTo: 2000,
  externalLyricsEnabled: true,
  useAmlldb: true,
  useKugou: true,
  useNetease: true,
  showDebug: false,
};
const stringSettings = new Set(["lyricSizePreset", "fontFamily", "letterSpacing", "backgroundRenderer"]);
const providerToggleIds = ["externalLyricsEnabled", "useAmlldb", "useKugou", "useNetease"];

const getActiveTab = async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];

const read = () => {
  const values = {};
  for (const id of Object.keys(defaults)) {
    const element = document.getElementById(id);
    if (!element) continue;
    values[id] = element.type === "checkbox" ? element.checked : stringSettings.has(id) ? element.value : Number(element.value);
  }
  return values;
};

const renderProviderVisibility = () => {
  const enabled = !!document.getElementById("externalLyricsEnabled")?.checked;
  document.querySelectorAll(".provider-option").forEach((row) => { row.hidden = !enabled; });
};

const applyValues = (values) => {
  for (const id of Object.keys(defaults)) {
    const element = document.getElementById(id);
    if (!element || values[id] === undefined) continue;
    if (element.type === "checkbox") element.checked = !!values[id];
    else element.value = values[id];
  }
  const range = document.getElementById("fontWeightRange");
  if (range) range.value = String(values.fontWeight ?? defaults.fontWeight);
  renderProviderVisibility();
  const debug = document.getElementById("debug");
  if (debug) debug.hidden = !values.showDebug;
};

document.querySelectorAll("nav button[data-page]").forEach((button) => button.addEventListener("click", () => {
  const page = button.dataset.page;
  document.querySelectorAll("nav button[data-page]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
  document.querySelectorAll(".page[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
}));

const renderDebug = (debug) => {
  const element = document.getElementById("debug");
  if (!element) return;
  if (!debug) { element.textContent = "暂无歌词请求记录"; return; }
  const attemptLines = Array.isArray(debug.attempts)
    ? ["", "来源尝试：", ...debug.attempts.map((attempt) => {
        const status = attempt.ok ? "成功" : "失败";
        const duration = attempt.durationMs !== undefined ? ` ${attempt.durationMs}ms` : "";
        const confidence = attempt.confidence !== undefined ? ` 匹配度 ${attempt.confidence}%` : "";
        const error = attempt.error ? `（${attempt.error}）` : "";
        return `  ${attempt.source}: ${status}${duration}${confidence}${error}`;
      })]
    : [];
  element.textContent = [`来源：${debug.source || "none"}`, `格式：${debug.format || "text"}`, `状态：${debug.status || ""}`, debug.matched ? `匹配：${debug.matched}` : "", debug.confidence ? `匹配度：${debug.confidence}%` : "", debug.durationMs !== undefined ? `耗时：${debug.durationMs}ms` : "", debug.at ? `时间：${debug.at}` : "", ...attemptLines, debug.rawPreview ? `\n${debug.rawPreview}` : ""].filter(Boolean).join("\n");
};

const updateCacheStats = async () => {
  const stats = await chrome.runtime.sendMessage({ type: "getCacheStats" }).catch(() => null);
  const element = document.getElementById("cacheStats");
  if (element) element.textContent = stats?.ok ? `${stats.count} 首歌曲，约 ${stats.kb} KB` : "暂无缓存数据";
};

const save = async () => {
  const values = read();
  await chrome.storage.local.set(values);
  const tab = await getActiveTab();
  if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "settingsUpdated", settings: values }).catch(() => {});
};

for (const id of Object.keys(defaults)) {
  const element = document.getElementById(id);
  element?.addEventListener("input", () => { if (providerToggleIds.includes(id)) renderProviderVisibility(); save(); });
  element?.addEventListener("change", () => { if (providerToggleIds.includes(id)) renderProviderVisibility(); save(); });
}
document.getElementById("fontWeightRange")?.addEventListener("input", (event) => {
  const value = event.currentTarget.value;
  const input = document.getElementById("fontWeight");
  if (input) input.value = value;
  save();
});

document.getElementById("refreshLyrics")?.addEventListener("click", async () => { const tab = await getActiveTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "refreshLyrics" }).catch(() => {}); });
document.getElementById("clearCache")?.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "clearLyricCache" }); const tab = await getActiveTab(); if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "clearLyricCache" }).catch(() => {}); await updateCacheStats(); });

document.getElementById("manualSearch")?.addEventListener("click", async () => {
  const status = document.getElementById("manualStatus");
  const select = document.getElementById("manualResults");
  if (!select) return;
  select.replaceChildren();
  if (status) status.textContent = "搜索中…";
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const song = await chrome.tabs.sendMessage(tab.id, { type: "getSongInfo" }).catch(() => ({}));
  const query = document.getElementById("manualQuery")?.value.trim() || song.title || "";
  const provider = document.getElementById("manualSource")?.value || "amll";
  const response = await chrome.runtime.sendMessage({ type: "searchLyrics", provider, query, artist: song.artist, durationMs: song.durationMs }).catch(() => null);
  if (!response?.ok || !Array.isArray(response.items)) { if (status) status.textContent = response?.error || "没有找到歌词"; return; }
  for (const item of response.items) { const option = document.createElement("option"); option.value = JSON.stringify(item); option.textContent = `${item.title || query}${item.artist ? ` - ${item.artist}` : ""}`; select.appendChild(option); }
  if (status) status.textContent = `找到 ${response.items.length} 条结果`;
});

document.getElementById("manualApply")?.addEventListener("click", async () => {
  const selected = document.getElementById("manualResults")?.selectedOptions[0];
  const status = document.getElementById("manualStatus");
  const tab = await getActiveTab();
  if (!selected || !tab?.id) { if (status) status.textContent = "请先选择搜索结果"; return; }
  if (status) status.textContent = "获取歌词中…";
  const response = await chrome.runtime.sendMessage({ type: "fetchManualLyrics", item: JSON.parse(selected.value) }).catch(() => null);
  if (!response?.ok) { if (status) status.textContent = response?.error || "获取歌词失败"; return; }
  await chrome.tabs.sendMessage(tab.id, { type: "applyManualLyrics", payload: response }).catch(() => {});
  if (status) status.textContent = "已应用到当前歌曲";
});

document.getElementById("loadCurrentLyrics")?.addEventListener("click", async () => {
  const status = document.getElementById("editStatus");
  const editor = document.getElementById("lyricEditor");
  const tab = await getActiveTab();
  if (!tab?.id || !editor) { if (status) status.textContent = "没有可用的播放页面"; return; }
  const response = await chrome.tabs.sendMessage(tab.id, { type: "getCurrentLyrics" }).catch(() => null);
  if (!response?.ok) { if (status) status.textContent = "读取当前歌词失败"; return; }
  editor.value = response.text || "";
  if (status) status.textContent = "已读取当前歌词";
});

document.getElementById("applyEditedLyrics")?.addEventListener("click", async () => {
  const status = document.getElementById("editStatus");
  const editor = document.getElementById("lyricEditor");
  const tab = await getActiveTab();
  if (!tab?.id || !editor || !editor.value.trim()) { if (status) status.textContent = "没有可应用的歌词文本"; return; }
  const response = await chrome.tabs.sendMessage(tab.id, { type: "applyManualLyrics", payload: { text: editor.value, format: "ttml", source: "manual", debug: "手动编辑歌词" } }).catch(() => null);
  if (status) status.textContent = response?.ok ? "已应用编辑后的歌词" : "应用失败";
});

const versionElement = document.getElementById("aboutVersion");
if (versionElement) versionElement.textContent = chrome.runtime.getManifest().version;
chrome.storage.local.get(defaults).then(applyValues);
chrome.storage.local.get({ lastLyricDebug: null }).then((value) => renderDebug(value.lastLyricDebug));
chrome.storage.onChanged.addListener((changes) => { if (changes.lastLyricDebug) renderDebug(changes.lastLyricDebug.newValue); if (changes.lyricCache) updateCacheStats(); });
updateCacheStats();
