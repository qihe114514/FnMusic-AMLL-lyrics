import { createApp, h, ref, shallowRef } from "vue";
import { LyricPlayer } from "@applemusic-like-lyrics/vue";
import { BackgroundRender as CoreBackgroundRender, MeshGradientRenderer, PixiRenderer } from "@applemusic-like-lyrics/core";
import "@applemusic-like-lyrics/core/style.css";
import "./style.css";
import { resolvePlaybackClock, type PlaybackAnchor } from "./playback-clock";
import { linesToTtml, mergeRomanization, mergeTranslation, normalizeLyrics, parseLyricText, type LyricFormat, type LyricLine, type Song } from "./shared";
import { DEFAULT_SETTINGS, PROVIDER_PRIORITY, SOURCE_TIMEOUT_MS, type ExternalProviderName, type ProviderName, type Settings } from "./settings";
import { evaluateMatch, normalizeSongKey } from "./matcher";
import { buildAmllQueryVariants } from "./lyrics/query-plan";
import { splitArtists } from "./lyrics/normalize";
import { bindWheelScroll, type AmllPlayerLike } from "./scroll-adapter";

type Source = ProviderName | "none";
type ProviderAttemptDebug = { source: string; ok: boolean; durationMs?: number; confidence?: number; error?: string; debug?: string };
type DebugInfo = { source: Source; format: LyricFormat; matched?: string; status: string; rawPreview: string; at: string; confidence?: number; durationMs?: number; attempts?: ProviderAttemptDebug[]; dom?: { rootClass?: string; rootDisplay?: string; playerText?: string; playerChildren?: number } };
type ProviderResult = { source: ExternalProviderName; format: LyricFormat; text: string; translation?: string; romanization?: string; matched?: string; debug?: string; confidence?: number; qualified?: boolean; matchReason?: string };
type ParsedResult = { source: ProviderName; format: LyricFormat; lines: LyricLine[]; raw: string; matched?: string; confidence: number; debug?: string; qualified: boolean; matchReason?: string; fallback?: boolean };

const lines = shallowRef<LyricLine[]>([]);
const displayLines = shallowRef<LyricLine[]>([]);
const currentTime = ref(0);
const playing = ref(false);
const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
const playerRef = shallowRef<any>(null);
type BackgroundInstance = { setRenderScale(scale: number): void; setFPS(fps: number): void; setStaticMode(enable: boolean): void; setLowFreqVolume(volume: number): void; setHasLyric(hasLyric: boolean): void; setAlbum(album: string | HTMLImageElement): Promise<void>; pause(): void; resume(): void; getElement(): HTMLElement; dispose(): void };

// AMLL Core 的 MeshGradientRenderer 会检查 WebGL1 的浮点纹理扩展。
// 在部分 Chrome + ANGLE 组合下这些扩展不会暴露，但渲染器仍可正常工作；
// 这里仅屏蔽这几条已知无害的 Core 警告，初始化失败仍然由 catch 处理。
const IGNORED_BACKGROUND_WARNINGS = /^(EXT_color_buffer_float|EXT_float_blend|OES_texture_float_linear|OES_texture_float) not supported$/;

const createBackground = (renderer: string) => {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && IGNORED_BACKGROUND_WARNINGS.test(args[0])) return;
    originalWarn.apply(console, args);
  };
  try {
    return CoreBackgroundRender.new((renderer === "pixi" ? PixiRenderer : MeshGradientRenderer) as typeof MeshGradientRenderer) as BackgroundInstance;
  } catch (error) {
    originalWarn.call(console, "[FnMusic AMLL] 背景渲染器初始化失败，已退化为无背景模式：", error);
    return null;
  } finally {
    console.warn = originalWarn;
  }
};
const state = { trackKey: "", trackGUID: "", titleKey: "", trackCacheKey: "", currentTrack: null as { guid: string; title?: string; artist?: string; durationMs?: number } | null, root: null as HTMLElement | null, app: null as ReturnType<typeof createApp> | null, backgroundRoot: null as HTMLElement | null, backgroundHost: null as HTMLElement | null, background: null as BackgroundInstance | null, backgroundRenderer: "mesh", backgroundPlaying: true, backgroundAlbum: "", backgroundFallback: false, original: null as HTMLElement | null, loadingKey: "", loadToken: 0, lastTime: -1, loadStarted: 0, firstLyricAt: 0, raf: 0, bridge: null as PlaybackAnchor | null, lowFreqVolume: 1, alignPosition: 0.3 };
const LYRIC_CACHE_VERSION = 2;
const lyricCache = new Map<string, { source: Source; format: LyricFormat; lines: LyricLine[]; raw: string; matched?: string; confidence?: number; at: number; v?: number; fallback?: boolean }>();
const lyricSizePresets: Record<string, string> = { tiny: "max(2.5vh, 1.25vw, 18px)", "extra-small": "max(3vh, 1.5vw, 20px)", small: "max(3.5vh, 1.75vw, 22px)", medium: "max(4.2vh, 2.1vw, 26px)", large: "max(5vh, 2.5vw, 30px)", "extra-large": "max(5.8vh, 2.9vw, 34px)", huge: "max(6.6vh, 3.3vw, 38px)" };
const cacheReady = chrome.storage.local.get({ lyricCache: {} }).then(({ lyricCache: saved }) => {
  if (!saved || typeof saved !== "object") return;
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    const item = value as Partial<{ source: Source; format: LyricFormat; lines: LyricLine[]; raw: string; matched?: string; confidence?: number; at: number; v?: number; fallback?: boolean }>;
    if ((item as { source?: string }).source === "qq") continue;
    if (item.v !== LYRIC_CACHE_VERSION) continue;
    if (Array.isArray(item.lines) && item.lines.length && typeof item.raw === "string") lyricCache.set(key, { source: item.source || "none", format: item.format || "ttml", lines: item.lines, raw: item.raw, matched: item.matched, confidence: item.confidence, at: Number(item.at) || Date.now(), v: LYRIC_CACHE_VERSION, fallback: item.fallback === true || item.source === "feiniu" });
  }
}).catch(() => {});

function isFeiniuPlayer() {
  return !!document.querySelector('.music-player-karaoke-lyrics, .music-player-progress-input, [aria-label="播放进度"]')
    && !!document.querySelector('.music-player-track-entry, [aria-label="全屏显示"], [aria-label="播放进度"]');
}

const UI_LABELS = new Set([
  "播放", "暂停", "上一首", "下一首", "收藏", "已收藏", "分享", "更多", "评论",
  "下载", "添加到歌单", "全屏显示", "退出全屏", "关闭", "歌词", "音质", "倍速",
  "播放列表", "喜欢", "不感兴趣", "随机播放", "循环播放", "单曲循环",
]);

function cleanSongText(value: string | null | undefined, title: string) {
  const text = value?.replace(/\s+/g, " ").trim() || "";
  if (!text || text === title || text.length > 80) return "";
  if (UI_LABELS.has(text)) return "";
  return text;
}

function readSong(): Song {
  const node = [...document.querySelectorAll<HTMLElement>("[data-track-guid], [data-track-guid-id], [data-guid]")].find((item) => item.dataset.trackGuid || item.dataset.trackGuidId || item.dataset.guid);
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label]');
  const title = state.currentTrack?.title || dialog?.getAttribute("aria-label")?.trim() || document.title.split("-")[0].trim();
  const artist = state.currentTrack?.artist || readArtistFromDialog(dialog, title);
  const guid = state.currentTrack?.guid || node?.dataset.trackGuid || node?.dataset.trackGuidId || node?.dataset.guid || `__title__${title}`;
  return { title, artist, guid };
}

function readArtistFromDialog(dialog: HTMLElement | null, title: string) {
  if (!dialog) return undefined;
  const preferred = [...dialog.querySelectorAll<HTMLElement>('[data-artist], a[href*="/artist"], [class*="artist" i], [aria-label*="歌手"], [title*="歌手"]')];
  for (const element of preferred) {
    const value = cleanSongText(element.textContent, title);
    if (value) return value;
  }
  return undefined;
}

function findNativeLyrics() { return document.querySelector<HTMLElement>(".music-player-karaoke-live-track"); }
function findViewport(target?: HTMLElement | null) { return target?.closest<HTMLElement>(".music-player-karaoke-lyrics") || document.querySelector<HTMLElement>(".music-player-karaoke-lyrics"); }
function findFullscreenDialog(target?: HTMLElement | null) { return target?.closest<HTMLElement>('[role="dialog"]') || null; }
function findMountHost(target?: HTMLElement | null) {
  const viewport = findViewport(target);
  if (!viewport) return null;
  const parent = viewport.parentElement;
  if (parent && getComputedStyle(parent).position !== "static") return parent;
  return viewport;
}

function joinSegmentText(node: HTMLElement) {
  const segments = [...node.querySelectorAll<HTMLElement>(".music-player-karaoke-segment, [data-karaoke-segment]")];
  if (!segments.length) return node.textContent?.replace(/\s+/g, " ").trim() || "";
  let text = "";
  for (const segment of segments) {
    const part = segment.textContent || "";
    if (!part) continue;
    if (text && /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(part)) text += " ";
    text += part;
  }
  return text.replace(/\s+/g, " ").trim();
}

function readNativeTranslation(node: HTMLElement, mainText: string) {
  const selectors = [
    '[data-karaoke-translation="true"]',
    '[data-translation]',
    '.music-player-karaoke-translation',
    '[class*="translation" i]',
    '[class*="translate" i]',
  ];
  for (const selector of selectors) {
    for (const element of node.querySelectorAll<HTMLElement>(selector)) {
      const text = cleanSongText(element.textContent, mainText);
      if (text && text !== mainText) return text;
    }
  }
  return "";
}

function readNativeLyrics(): LyricLine[] {
  const nodes = [...document.querySelectorAll<HTMLElement>('.music-player-karaoke-live-track [data-karaoke-line="true"]')];
  const entries = nodes.map((node) => ({ node, text: joinSegmentText(node), translation: "" })).filter((entry) => !!entry.text);
  if (!entries.length) {
    const container = findNativeLyrics();
    const text = container?.innerText?.replace(/\r/g, "").trim() || "";
    return text ? parseLyricText(text, "text") : [];
  }
  for (const entry of entries) {
    entry.translation = readNativeTranslation(entry.node, entry.text);
  }
  const fallback = parseLyricText(entries.map((entry) => entry.text).join("\n"), "text");
  return fallback.map((line, index) => ({ ...line, translatedLyric: entries[index]?.translation || "" }));
}

function trackKey(song: Song) { return `${song.guid}|${song.title}|${Math.round(songDurationMs() / 1000)}`; }
function songDurationMs() { return Number(state.currentTrack?.durationMs || 0) || Number(document.querySelector<HTMLInputElement>('[aria-label="播放进度"]')?.max || 0) * 1000; }
function songCacheKey(song: Song) { return normalizeSongKey({ title: song.title, artist: song.artist, durationMs: songDurationMs() }); }
function enabledExternalProviders(): ExternalProviderName[] {
  if (!settings.value.externalLyricsEnabled) return [];
  return [
    ...(settings.value.useAmlldb ? ["amll" as const] : []),
    ...(settings.value.useKugou ? ["kugou" as const] : []),
    ...(settings.value.useNetease ? ["netease" as const] : []),
  ];
}
function providerEnabled(provider: ExternalProviderName) {
  return provider === "amll" ? settings.value.useAmlldb : provider === "kugou" ? settings.value.useKugou : settings.value.useNetease;
}
function refreshDisplayLines() {
  displayLines.value = lines.value.map((line) => settings.value.swapTranslationRomanization
    ? { ...line, words: line.words.map((word) => ({ ...word })), translatedLyric: line.romanLyric, romanLyric: line.translatedLyric }
    : line);
}

const LYRIC_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function getCachedLyrics(key: string) {
  const item = lyricCache.get(key);
  if (!item) return undefined;
  if (Date.now() - item.at > LYRIC_CACHE_TTL_MS) { lyricCache.delete(key); return undefined; }
  return item;
}

async function persistCache(key: string, entry: Omit<NonNullable<ReturnType<typeof lyricCache.get>>, "at">) {
  if (!key) return;
  lyricCache.set(key, { ...entry, at: Date.now(), v: LYRIC_CACHE_VERSION });
  const entries = [...lyricCache.entries()].sort(([, a], [, b]) => b.at - a.at).slice(0, 80);
  lyricCache.clear();
  for (const [entryKey, value] of entries) lyricCache.set(entryKey, value);
  await chrome.storage.local.set({ lyricCache: Object.fromEntries(entries) }).catch(() => {});
}

function getAmllPlayer(): AmllPlayerLike | undefined {
  const exposed = playerRef.value?.lyricPlayer;
  return (exposed?.value ?? exposed) as AmllPlayerLike | undefined;
}

type PlayerWithLyrics = AmllPlayerLike & {
  setLyricLines?: (lines: LyricLine[], initialTime?: number) => void;
  getLyricLines?: () => LyricLine[];
  update?: (delta?: number) => void;
};

function hasRenderedLyricLine() {
  return !!state.root?.querySelector(".FmKaba_lyricLineWrapper");
}

function forcePlayerLayout() {
  const player = getAmllPlayer() as PlayerWithLyrics | undefined;
  if (!player?.calcLayout) return false;
  try {
    player.calcLayout(true, true);
    player.update?.(0);
    return true;
  } catch (error) {
    console.warn("[FnMusic AMLL] 歌词布局失败：", error);
    return false;
  }
}

function applyLinesToPlayer(force = false) {
  const player = getAmllPlayer() as PlayerWithLyrics | undefined;
  if (!player?.setLyricLines || !displayLines.value.length) return false;
  const renderedLines = player.getLyricLines?.() ?? [];
  if (!force && renderedLines.length === displayLines.value.length) {
    if (!hasRenderedLyricLine()) forcePlayerLayout();
    return true;
  }
  try {
    const time = currentTime.value + Number(settings.value.offset || 0);
    player.setLyricLines(displayLines.value, time);
    player.setCurrentTime?.(time, true);
    forcePlayerLayout();
    if (force) {
      const token = state.loadToken;
      const track = state.trackKey;
      const retry = () => {
        if (token !== state.loadToken || track !== state.trackKey) return;
        forcePlayerLayout();
      };
      window.setTimeout(retry, 0);
      window.setTimeout(retry, 350);
    }
    return true;
  } catch (error) {
    console.warn("[FnMusic AMLL] 歌词行应用失败：", error);
    return false;
  }
}

function seekToLine(event: { lineIndex: number }) {
  const line = lines.value[event.lineIndex];
  const slider = document.querySelector<HTMLInputElement>('[aria-label="播放进度"]');
  if (!line || !slider) return;
  const target = Math.max(0, (line.startTime - Number(settings.value.offset || 0)) / 1000);
  const oldStep = slider.getAttribute("step") || "1";
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  slider.setAttribute("step", "any");
  nativeSetter?.call(slider, String(target));
  slider.setAttribute("value", String(target));
  slider.focus({ preventScroll: true });
  slider.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 }));
  slider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, buttons: 1 }));
  slider.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  slider.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  slider.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true, buttons: 0 }));
  slider.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 }));
  slider.setAttribute("step", oldStep);
  currentTime.value = Math.round(target * 1000);
  state.bridge = { currentTimeMs: currentTime.value, observedAt: performance.now(), playing: playing.value };
  getAmllPlayer()?.setCurrentTime?.(currentTime.value + Number(settings.value.offset || 0), true);
  getAmllPlayer()?.resetScroll?.();
  startProgressLoop();
}

function updateAlignPosition(viewport: HTMLElement) {
  const dialog = findFullscreenDialog(viewport);
  const cover = dialog?.querySelector<HTMLImageElement>('img[src*="/music/api/v1/static/cover"]');
  const viewportBox = viewport.getBoundingClientRect();
  const coverBox = cover?.getBoundingClientRect();
  if (!coverBox || viewportBox.height <= 0) return;
  state.alignPosition = Math.max(0.1, Math.min(0.9, (coverBox.top + coverBox.height / 2 - viewportBox.top) / viewportBox.height));
}

function applyBackgroundVisibility() {
  if (!state.root) return;
  state.root.classList.toggle("is-background-fallback", !state.background);
}

function syncBackground(target?: HTMLElement | null) {
  const dialog = findFullscreenDialog(target || findNativeLyrics());
  if (!dialog) return;
  const cover = dialog.querySelector<HTMLImageElement>('img[src*="/music/api/v1/static/cover"]');
  const nativeBackground = dialog.children[0] as HTMLElement | undefined;
  if (!nativeBackground) return;
  let host: Node = nativeBackground.shadowRoot || nativeBackground;
  if (!nativeBackground.shadowRoot) {
    try { host = nativeBackground.attachShadow({ mode: "open" }); } catch { host = nativeBackground; }
  }
  const renderer = settings.value.backgroundRenderer === "pixi" ? "pixi" : "mesh";
  try {
    if (!state.backgroundRoot || !state.background || state.backgroundRenderer !== renderer) {
      state.background?.dispose();
      state.backgroundRenderer = renderer;
      state.backgroundRoot = document.createElement("div");
      state.backgroundRoot.id = "fnmusic-amll-background";
      state.backgroundRoot.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;background:transparent;";
      state.background = createBackground(renderer);
      if (!state.background) {
        state.backgroundRoot.remove();
        state.backgroundRoot = null;
        return;
      }
      const canvas = state.background.getElement();
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;min-width:0;min-height:0;z-index:0;";
      const shade = document.createElement("div");
      shade.style.cssText = "position:absolute;inset:0;pointer-events:none;background:linear-gradient(#0000 60%, #0000001a 100%);z-index:1;";
      state.backgroundRoot.replaceChildren(canvas, shade);
    }
  } catch (error) {
    console.warn("[FnMusic AMLL] 背景渲染器不可用，保留 FnMusic 原生背景：", error);
    state.backgroundRoot?.remove();
    state.backgroundRoot = null;
    state.background = null;
    state.backgroundFallback = true;
    applyBackgroundVisibility();
    return;
  }
  if (!state.background || !state.backgroundRoot) {
    state.backgroundFallback = true;
    applyBackgroundVisibility();
    return;
  }
  state.backgroundFallback = false;
  applyBackgroundVisibility();
  nativeBackground.style.setProperty("background", "transparent", "important");
  nativeBackground.style.setProperty("background-image", "none", "important");
  if (state.backgroundRoot.parentNode !== host) host.appendChild(state.backgroundRoot);
  state.backgroundHost = nativeBackground;
  applyBackgroundSettings();
  const source = cover?.currentSrc || cover?.src || "";
  if (cover && source && source !== state.backgroundAlbum) {
    state.backgroundAlbum = source;
    void state.background?.setAlbum(source).catch(() => state.background?.setAlbum(cover)).catch(() => {});
  }
}

function mount(target: HTMLElement) {
  if (state.root) {
    if (state.root.parentElement !== target) target.appendChild(state.root);
    return;
  }
  state.root = document.createElement("div");
  state.root.id = "fnmusic-amll-root";
  target.appendChild(state.root);
  applyBackgroundVisibility();
  state.app = createApp({ setup: () => () => h(LyricPlayer, {
    ref: playerRef,
    disabled: false,
    playing: playing.value,
    alignAnchor: "center",
    alignPosition: state.alignPosition,
    enableSpring: settings.value.spring,
    enableBlur: settings.value.blur && playing.value,
    enableScale: settings.value.scale,
    wordFadeWidth: Math.max(0.0001, Number(settings.value.wordFadeWidth) || 0.5),
    lyricLines: displayLines.value,
    currentTime: currentTime.value + Number(settings.value.offset || 0),
    onLineClick: seekToLine,
  }) });
  state.app.mount(state.root);
  applySettingsStyle();
}

function showOriginal() {
  state.original?.style.removeProperty("display");
  state.original = null;
  state.root?.classList.remove("is-visible", "no-lyrics", "is-loading");
}

function claimAmll() {
  const native = findNativeLyrics();
  const host = findMountHost(native);
  if (!native || !host) return false;
  try { syncBackground(native); } catch (error) { console.warn("[FnMusic AMLL] 背景初始化异常，继续加载歌词：", error); }
  state.original = native;
  mount(host);
  native.style.setProperty("display", "none", "important");
  state.root?.classList.add("is-visible", "is-loading", "no-lyrics");
  return true;
}

function showAmll() {
  const native = findNativeLyrics();
  const host = findMountHost(native);
  if (!native || !host || !lines.value.length) return;
  refreshDisplayLines();
  syncBackground(native);
  state.original = native;
  mount(host);
  applyLinesToPlayer(true);
  native.style.setProperty("display", "none", "important");
  state.root?.classList.add("is-visible");
  state.root?.classList.remove("is-loading", "no-lyrics");
}

function applySettingsStyle() {
  if (state.root) {
    state.root.style.setProperty("--amll-lp-font-size", lyricSizePresets[settings.value.lyricSizePreset] || lyricSizePresets.medium);
    state.root.style.setProperty("--amll-lp-font-family", settings.value.fontFamily || "Microsoft YaHei");
    state.root.style.setProperty("--amll-lp-font-weight", String(Number(settings.value.fontWeight) || 600));
    state.root.style.setProperty("--amll-lp-letter-spacing", settings.value.letterSpacing || "normal");
    state.root.style.setProperty("--amll-translation-display", settings.value.showTranslation ? "block" : "none");
    state.root.style.setProperty("--amll-roman-display", settings.value.showRomanization ? "block" : "none");
  }
  window.postMessage({ source: "fnmusic-amll-audio-config", fftFrom: Number(settings.value.fftFrom) || 80, fftTo: Number(settings.value.fftTo) || 2000 }, "*");
  refreshDisplayLines();
  applyBackgroundSettings();
}

function applyBackgroundSettings() {
  if (!state.background) return;
  try {
    state.background.setRenderScale(Math.max(0.01, Math.min(10, Number(settings.value.backgroundRenderScale) || 1)));
    state.background.setFPS(Math.max(1, Math.min(1000, Math.round(Number(settings.value.backgroundFps) || 60))));
    state.background.setStaticMode(!!settings.value.backgroundStaticMode);
    state.background.setHasLyric(lines.value.length > 0);
    state.background.setLowFreqVolume(state.lowFreqVolume);
  } catch (error) {
    console.warn("[FnMusic AMLL] 背景设置应用失败，已禁用背景：", error);
    state.background = null;
  }
}

function applyBackgroundPlayback(nextPlaying: boolean) {
  if (!state.background || state.backgroundPlaying === nextPlaying) return;
  state.backgroundPlaying = nextPlaying;
  if (nextPlaying) state.background.resume();
  else state.background.pause();
}

async function saveDebug(debug: DebugInfo) {
  chrome.runtime.sendMessage({ type: "saveLyricDebug", debug }).catch(() => {});
}

function setDebug(source: Source, format: LyricFormat, status: string, raw: string, matched?: string, confidence?: number, durationMs?: number, attempts?: ProviderAttemptDebug[]) {
  const root = document.querySelector<HTMLElement>("#fnmusic-amll-root");
  const player = root?.querySelector<HTMLElement>(".amll-lyric-player");
  const dom = {
    rootClass: root?.className,
    rootDisplay: root ? getComputedStyle(root).display : "missing",
    playerText: player?.innerText?.replace(/\s+/g, " ").trim().slice(0, 200),
    playerChildren: player?.childElementCount,
  };
  void saveDebug({ source, format, status, matched, rawPreview: raw.slice(0, 1000), at: new Date().toISOString(), confidence, durationMs, attempts, dom });
}

async function loadFeiniu(guid: string, payload?: unknown) {
  if (payload !== undefined) {
    const parsed = normalizeLyrics(payload);
    if (parsed.length) return { lines: parsed, raw: linesToTtml(parsed), format: "ttml" as LyricFormat };
  }
  if (guid.startsWith("__title__") || guid.startsWith("title:")) return null;
  try {
    const response = await fetch(`/music/api/v1/lyric/list?trackGUID=${encodeURIComponent(guid)}`, { credentials: "include", signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json();
    const parsed = normalizeLyrics(body);
    return parsed.length ? { lines: parsed, raw: linesToTtml(parsed), format: "ttml" as LyricFormat } : null;
  } catch {
    return null;
  }
}

function parseProviderResult(result: ProviderResult): ParsedResult | null {
  let parsed = parseLyricText(result.text, result.format);
  if (result.translation) parsed = mergeTranslation(parsed, parseLyricText(result.translation, "lrc"));
  if (result.romanization) parsed = mergeRomanization(parsed, parseLyricText(result.romanization, "lrc"));
  if (!parsed.length) return null;
  const wordByWord = parsed.some((line) => line.words.length > 1);
  if (result.source === "amll" && !wordByWord) return null;
  return {
    source: result.source,
    format: result.format,
    lines: parsed,
    raw: result.text,
    matched: result.matched,
    confidence: result.confidence ?? (result.qualified === false ? 0 : 100),
    debug: result.debug,
    qualified: result.qualified !== false,
    matchReason: result.matchReason,
  };
}

async function loadExternalProvider(song: Song, provider: ExternalProviderName) {
  if (!settings.value.externalLyricsEnabled || !providerEnabled(provider)) return null;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "fetchProviderLyrics", provider, title: song.title, artist: song.artist, durationMs: songDurationMs() }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SOURCE_TIMEOUT_MS)),
    ]);
    if (response?.ok && typeof response.text === "string") return response as ProviderResult;
  } catch {}
  if (provider === "amll") return loadAmlldbDirect(song);
  return null;
}

async function loadExternalEngine(song: Song): Promise<{ best: ProviderResult | null; attempts: ProviderAttemptDebug[] }> {
  const order = enabledExternalProviders();
  if (!order.length) return { best: null, attempts: [] };
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: "lyrics:load", title: song.title, artist: song.artist, album: song.album, durationMs: songDurationMs(), order }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SOURCE_TIMEOUT_MS)),
    ]);
    if (response?.best || Array.isArray(response?.attempts)) {
      return { best: (response?.best as ProviderResult) || null, attempts: (response?.attempts as ProviderAttemptDebug[]) || [] };
    }
  } catch {}
  return { best: null, attempts: [] };
}

async function loadAmlldbDirect(song: Song): Promise<ProviderResult | null> {
  try {
    const variants = buildAmllQueryVariants({ title: song.title, artists: song.artist ? [song.artist] : [] });
    const itemMap = new Map<string, any>();
    for (const variant of variants) {
      try {
        const params = new URLSearchParams({ musicName: variant.musicName, page: "1", pageSize: "10" });
        if (variant.artistName) params.set("artistName", variant.artistName);
        const search = await fetch(`https://api.amll.dev/v1/lyrics/search?${params}`, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) }).then((response) => response.json());
        const items = Array.isArray(search?.data?.items) ? search.data.items : [];
        for (const item of items) if (item?.id !== undefined) itemMap.set(String(item.id), item);
      } catch {
        // try next variant
      }
    }
    const candidates = [...itemMap.values()].map((item: any) => ({
      item,
      title: item.musicNames?.[0] || "",
      artist: item.artistNames?.join(" / ") || "",
      match: evaluateMatch({ title: song.title, artists: song.artist ? splitArtists(song.artist) : [], durationMs: songDurationMs() }, { title: item.musicNames?.[0] || "", artists: item.artistNames || [] }),
    })).filter((entry: any) => entry.match.qualified).slice(0, 3);
    const results: Array<ProviderResult | null> = await Promise.all(candidates.map(async (entry: any) => {
      try {
        const detail = await fetch(`https://api.amll.dev/v1/lyrics/get?id=${encodeURIComponent(String(entry.item.id))}`, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) }).then((response) => response.json());
        const text = detail?.data?.lyrics;
        if (typeof text !== "string" || !text.trim()) return null;
        return {
          source: "amll" as const,
          format: "ttml" as const,
          text,
          matched: entry.title,
          confidence: Math.round(entry.match.combined * 100),
          qualified: true,
          debug: `AMLL #${entry.item.id}，匹配度 ${Math.round(entry.match.combined * 100)}%`,
          matchReason: entry.match.reason,
        } satisfies ProviderResult;
      } catch {
        return null;
      }
    }));
    return results.find((result): result is ProviderResult => !!result) || null;
  } catch {
    return null;
  }
}

async function loadTrack(key: string, payload?: unknown) {
  if (key === state.loadingKey) return;
  if (key === state.trackKey && !lines.value.length && Date.now() - state.loadStarted < 4000) return;
  state.loadingKey = key;
  const token = ++state.loadToken;
  if (key !== state.trackKey) {
    state.bridge = null;
    state.lastTime = -1;
    currentTime.value = 0;
  }
  state.loadStarted = Date.now();
  state.firstLyricAt = 0;
  state.trackKey = key;
  state.trackGUID = key.split("|")[0];
  const song = readSong();
  const durationMs = songDurationMs();
  const cacheKey = normalizeSongKey({ title: song.title, artist: song.artist, durationMs });
  state.trackCacheKey = cacheKey;
  state.titleKey = `${song.title}|${document.querySelector<HTMLInputElement>('[aria-label="播放进度"]')?.max || ""}`;
  lines.value = [];
  displayLines.value = [];
  claimAmll();

  let watchdog = 0;
  const fallbackToNative = async () => {
    if (token !== state.loadToken) return false;
    const fallback = readNativeLyrics();
    if (!fallback.length) return false;
    lines.value = fallback;
    setDebug("feiniu", "ttml", "FnMusic 自带歌词", linesToTtml(fallback), undefined, undefined, Date.now() - state.loadStarted);
    showAmll();
    return true;
  };

  try {
    await cacheReady;
    const cached = getCachedLyrics(cacheKey) || getCachedLyrics(key);
    if (!cached) {
      void fallbackToNative();
    } else if (cached.fallback && settings.value.externalLyricsEnabled) {
      if (token !== state.loadToken) return;
      lines.value = cached.lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }));
      setDebug(cached.source, cached.format, "FnMusic 自带歌词（同时匹配 AMLL / 酷狗 / 网易云）", cached.raw, cached.matched, cached.confidence, Date.now() - state.loadStarted);
      showAmll();
    } else {
      if (token !== state.loadToken) return;
      lines.value = cached.lines.map((line) => ({ ...line, words: line.words.map((word) => ({ ...word })) }));
      state.firstLyricAt = Date.now() - state.loadStarted;
      setDebug(cached.source, cached.format, "使用歌词缓存", cached.raw, cached.matched, cached.confidence, state.firstLyricAt);
      showAmll();
      return;
    }

    let selected: ParsedResult | null = null;
    const commit = (result: ParsedResult) => {
      if (token !== state.loadToken || !result.qualified || !result.lines.length) return;
      const rank = PROVIDER_PRIORITY.indexOf(result.source);
      if (selected) {
        const selectedRank = PROVIDER_PRIORITY.indexOf(selected.source);
        if (rank > selectedRank) return;
        if (rank === selectedRank && (result.confidence || 0) <= (selected.confidence || 0)) return;
      }
      selected = result;
      lines.value = result.lines;
      if (!state.firstLyricAt) state.firstLyricAt = Date.now() - state.loadStarted;
      if (result.source !== "feiniu" && result.fallback !== true) {
      void persistCache(cacheKey, { source: result.source, format: result.format, lines: result.lines, raw: result.raw, matched: result.matched, confidence: result.confidence, fallback: false });
    }
      setDebug(result.source, result.format, `${result.debug || "歌词成功"}；匹配度 ${result.confidence || 0}%`, result.raw, result.matched, result.confidence, Date.now() - state.loadStarted, attempts);
      showAmll();
    };

    let attempts: ProviderAttemptDebug[] = [];
    const externalTask = (async () => {
      if (!settings.value.externalLyricsEnabled) return;
      const engine = await loadExternalEngine(song);
      attempts = engine.attempts;
      if (engine.best) {
        const parsed = parseProviderResult(engine.best);
        if (parsed) {
          commit(parsed);
          return;
        }
      }
      if (providerEnabled("amll")) {
        const direct = await loadAmlldbDirect(song);
        const parsed = direct ? parseProviderResult(direct) : null;
        if (parsed) commit(parsed);
      }
    })();

    let nativeResult: ParsedResult | null = null;
    const nativeTask = loadFeiniu(state.trackGUID, payload).then((native) => {
      if (!native?.lines.length) return;
      nativeResult = {
        source: "feiniu",
        format: native.format,
        lines: native.lines,
        raw: native.raw,
        matched: song.title,
        confidence: state.trackGUID.startsWith("__title__") ? 70 : 90,
        qualified: true,
        debug: "FnMusic 自带歌词",
      };
    }).catch(() => {});

    watchdog = window.setTimeout(() => {
      void (async () => {
        if (token !== state.loadToken || lines.value.length) return;
        if (nativeResult) commit(nativeResult);
        if (!lines.value.length) await fallbackToNative();
        if (!lines.value.length) {
          setDebug("none", "text", "无可用歌词", "");
          showOriginal();
        }
      })();
    }, 4_000);

    await Promise.allSettled([externalTask, nativeTask]);
    if (token !== state.loadToken) return;
    if (!selected && nativeResult) commit(nativeResult);
    if (!selected && await fallbackToNative()) return;
    if (!selected) {
      setDebug("none", "text", "无可用歌词", "");
      showOriginal();
    }
  } catch (error) {
    if (token !== state.loadToken) return;
    setDebug("none", "text", `加载失败：${error instanceof Error ? error.message : String(error)}`, "");
    if (!(await fallbackToNative())) showOriginal();
  } finally {
    if (watchdog) window.clearTimeout(watchdog);
    if (state.loadingKey === key) state.loadingKey = "";
  }
}

function syncTrack() {
  if (!isFeiniuPlayer()) return;
  const native = findNativeLyrics();
  const viewport = findViewport(native);
  const host = findMountHost(native);
  if (!native || !viewport || !host) return;
  native.querySelectorAll<HTMLElement>(".music-player-karaoke-live-time").forEach((node) => node.style.setProperty("display", "none", "important"));
  const song = readSong();
  const key = trackKey(song);
  if (state.root && state.root.parentElement !== host) host.appendChild(state.root);
  updateAlignPosition(viewport);
  syncBackground(native);
  if (!state.root) claimAmll();
  const currentTitleKey = `${song.title}|${document.querySelector<HTMLInputElement>('[aria-label="播放进度"]')?.max || ""}`;
  if (key !== state.trackKey && !(state.titleKey === currentTitleKey && !state.trackGUID.startsWith("__title__"))) void loadTrack(key);
  if (state.root?.classList.contains("is-visible")) {
    if (lines.value.length) applyLinesToPlayer();
    native.style.setProperty("display", "none", "important");
  }
}

function syncDisplayedProgress(now = performance.now()) {
  const slider = document.querySelector<HTMLInputElement>('[aria-label="播放进度"]');
  const value = Number(slider?.value);
  const snapshot = resolvePlaybackClock({
    now,
    bridge: state.bridge,
    fallback: { currentTimeMs: Number.isFinite(value) ? Math.round(value * 1000) : currentTime.value, playing: !!document.querySelector('[aria-label="暂停"]') },
  });
  const next = snapshot.currentTimeMs;
  if (next !== state.lastTime) {
    state.lastTime = next;
    currentTime.value = next;
  }
  playing.value = snapshot.playing;
  applyBackgroundPlayback(snapshot.playing);
}

function bindOffsetButtons() {
  document.querySelectorAll<HTMLButtonElement>('[aria-label="歌词提前"], [aria-label="歌词延后"]').forEach((button) => {
    if (button.dataset.amllBound) return;
    button.dataset.amllBound = "1";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = button.getAttribute("aria-label") === "歌词提前" ? 500 : -500;
      settings.value.offset = Math.max(-5000, Math.min(5000, Number(settings.value.offset || 0) + delta));
      chrome.storage.local.set({ offset: settings.value.offset }).catch(() => {});
      applySettingsStyle();
    }, true);
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source === "fnmusic-amll-playback") {
    const currentTimeMs = Number(event.data.currentTimeMs);
    if (!Number.isFinite(currentTimeMs)) return;
    state.bridge = { currentTimeMs: Math.max(0, Math.round(currentTimeMs)), observedAt: performance.now(), playing: !!event.data.playing };
    if (Number.isFinite(Number(event.data.lowFreqVolume))) {
      state.lowFreqVolume = Math.max(0, Math.min(1, Number(event.data.lowFreqVolume)));
      state.background?.setLowFreqVolume(state.lowFreqVolume);
    }
    syncDisplayedProgress();
    if (playing.value) startProgressLoop();
    return;
  }
  if (event.data?.source === "fnmusic-amll-track" && event.data.trackGUID) {
    const track = event.data.track || {};
    const artist = Array.isArray(track.artists) ? track.artists.map((item: any) => item?.name).filter(Boolean).join(" / ") : undefined;
    state.currentTrack = {
      guid: String(event.data.trackGUID),
      title: typeof track.title === "string" ? track.title : undefined,
      artist,
      durationMs: Number(track.duration || track.audioSpec?.duration || 0) || undefined,
    };
    state.trackGUID = state.currentTrack.guid;
    const song = readSong();
    void loadTrack(trackKey(song));
    return;
  }
  if (event.data?.source !== "fnmusic-amll" || !event.data.trackGUID) return;
  if (!state.currentTrack || state.currentTrack.guid !== String(event.data.trackGUID)) {
    state.currentTrack = { guid: String(event.data.trackGUID), title: state.currentTrack?.title, artist: state.currentTrack?.artist, durationMs: state.currentTrack?.durationMs };
  }
  const song = readSong();
  const key = trackKey(song);
  if (key === state.trackKey && (lines.value.length > 0 || (!event.data.payload && Date.now() - state.loadStarted < 3000))) return;
  void loadTrack(key, event.data.payload);
});

let observerTimer = 0;
const observer = new MutationObserver(() => {
  if (isFeiniuPlayer() && !state.root) claimAmll();
  if (observerTimer) return;
  observerTimer = window.setTimeout(() => { observerTimer = 0; bindOffsetButtons(); syncBackground(); syncTrack(); }, 160);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("online", () => {
  chrome.runtime.sendMessage({ type: "clearNegativeLyricCache" }).catch(() => {});
  const song = readSong();
  const key = trackKey(song);
  void loadTrack(key);
});

bindWheelScroll(() => state.root, () => getAmllPlayer());
window.postMessage({ source: "fnmusic-amll-request-track" }, "*");
chrome.runtime.sendMessage({ type: "getSettings" }).then((saved) => { if (saved) Object.assign(settings.value, saved); applySettingsStyle(); }).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "settingsUpdated") {
    const before = JSON.stringify({ external: settings.value.externalLyricsEnabled, amll: settings.value.useAmlldb, kugou: settings.value.useKugou, netease: settings.value.useNetease });
    Object.assign(settings.value, message.settings || {});
    applySettingsStyle();
    const after = JSON.stringify({ external: settings.value.externalLyricsEnabled, amll: settings.value.useAmlldb, kugou: settings.value.useKugou, netease: settings.value.useNetease });
    if (before !== after) {
      state.trackKey = "";
      const song = readSong();
      const slider = document.querySelector<HTMLInputElement>('[aria-label="播放进度"]');
      void loadTrack(`${state.trackGUID && !state.trackGUID.startsWith("__title__") ? state.trackGUID : song.guid}|${song.title}|${slider?.max || ""}`);
    }
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "refreshLyrics") {
    state.trackKey = "";
    const song = readSong();
    const slider = document.querySelector<HTMLInputElement>('[aria-label="播放进度"]');
    void loadTrack(`${state.trackGUID && !state.trackGUID.startsWith("__title__") ? state.trackGUID : song.guid}|${song.title}|${slider?.max || ""}`);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "clearLyricCache") {
    lyricCache.clear();
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "getSongInfo") {
    const song = readSong();
    sendResponse({ ...song, durationMs: songDurationMs() });
    return;
  }
  if (message?.type === "getCurrentLyrics") {
    sendResponse({ ok: true, source: "current", format: "ttml", text: linesToTtml(lines.value) });
    return;
  }
  if (message?.type === "applyManualLyrics") {
    const payload = message.payload || {};
    const parsed = parseLyricText(String(payload.text || ""), payload.format);
    if (!parsed.length) { sendResponse({ ok: false }); return; }
    void (async () => {
      state.loadToken += 1;
      lines.value = payload.translation ? mergeTranslation(parsed, parseLyricText(payload.translation, "lrc")) : parsed;
      if (payload.romanization) lines.value = mergeRomanization(lines.value, parseLyricText(payload.romanization, "lrc"));
      const cacheKey = state.trackCacheKey || state.trackKey;
      await persistCache(cacheKey, { source: payload.source || "none", format: payload.format || "lrc", lines: lines.value, raw: linesToTtml(lines.value), matched: payload.matched, confidence: payload.confidence });
      setDebug(payload.source || "none", payload.format || "text", payload.debug || "手动歌词", linesToTtml(lines.value), payload.matched, payload.confidence);
      showAmll();
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
  return;
});

syncTrack();
bindOffsetButtons();
const frame = (now: number) => {
  syncDisplayedProgress(now);
  state.raf = playing.value ? requestAnimationFrame(frame) : 0;
};
function startProgressLoop() {
  if (!state.raf) state.raf = requestAnimationFrame(frame);
}
syncDisplayedProgress();
if (playing.value) startProgressLoop();
setInterval(() => {
  bindOffsetButtons();
  syncBackground();
  syncTrack();
  syncDisplayedProgress();
  if (playing.value) startProgressLoop();
  if (!playing.value && state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
}, 800);
