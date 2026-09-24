import { DEFAULT_SETTINGS, SOURCE_TIMEOUT_MS, CACHE_TTL_MS, type ExternalProviderName } from "./settings";
import { evaluateMatch, normalizeSongKey, type MatchCandidate, type MatchInput, type MatchResult } from "./matcher";

type ExternalRequest = {
  type: "fetchProviderLyrics";
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  provider?: ExternalProviderName;
};

type ProviderMatch = {
  source: ExternalProviderName;
  format: "ttml" | "lrc" | "krc";
  text: string;
  translation?: string;
  romanization?: string;
  matched: string;
  debug: string;
  confidence: number;
  qualified: boolean;
  matchReason: string;
};

type Candidate = MatchCandidate & {
  raw: any;
  id?: string | number;
  hash?: string;
  albumAudioId?: string | number;
};

const providerCache = new Map<string, { at: number; result: ProviderMatch }>();
const providerPending = new Map<string, Promise<ProviderMatch>>();

function toMatchInput(request: Pick<ExternalRequest, "title" | "artist" | "durationMs">): MatchInput {
  return { title: request.title, artist: request.artist, durationMs: request.durationMs };
}

async function getJson(url: string, init?: RequestInit, timeoutMs = SOURCE_TIMEOUT_MS) {
  const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<any>;
}

function hasTimedLyric(value: unknown) {
  return typeof value === "string" && (/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(value) || /<(?:tt|p|span)\b/i.test(value) || /\[\d+,\d+\]/.test(value) || /<\d+,\d+,\d+>/.test(value));
}

function decodeMaybeBase64(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (hasTimedLyric(text)) return text;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(text) || text.length < 16) return text;
  try {
    const normalized = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)));
    return hasTimedLyric(decoded) ? decoded : text;
  } catch { return text; }
}

function candidateDuration(item: any) {
  if (Number(item?.durationMs)) return Number(item.durationMs);
  if (Number(item?.durationInMs)) return Number(item.durationInMs);
  if (Number(item?.dt)) return Number(item.dt);
  return Number(item?.duration || item?.interval || 0) * 1000;
}

function rankCandidates(request: ExternalRequest, candidates: Candidate[]) {
  return candidates
    .map((candidate) => ({ candidate, match: evaluateMatch(toMatchInput(request), candidate) }))
    .sort((left, right) => right.match.combined - left.match.combined);
}

function resultFromMatch(
  source: ExternalProviderName,
  format: ProviderMatch["format"],
  text: string,
  matched: string,
  match: MatchResult,
  options: { translation?: string; romanization?: string; detail?: string } = {},
): ProviderMatch {
  const confidence = Math.round(match.combined * 100);
  return {
    source,
    format,
    text,
    translation: options.translation,
    romanization: options.romanization,
    matched,
    confidence,
    qualified: match.qualified,
    matchReason: match.reason,
    debug: `${options.detail ? `${options.detail}，` : ""}匹配度 ${confidence}%`,
  };
}

async function fetchAmlldb(request: ExternalRequest) {
  const params = new URLSearchParams({ musicName: request.title, page: "1", pageSize: "10" });
  if (request.artist) params.set("artistName", request.artist);
  const search = await getJson(`https://api.amll.dev/v1/lyrics/search?${params}`);
  const items = Array.isArray(search?.data?.items) ? search.data.items : [];
  const matchInput = request;
  const candidates: Candidate[] = items.map((item: any) => ({
    raw: item,
    id: item.id,
    title: item.musicNames?.[0] || request.title,
    artist: item.artistNames?.join(" / ") || "",
    durationMs: candidateDuration(item),
  }));
  const ranked = rankCandidates(matchInput, candidates).filter((entry) => entry.match.qualified).slice(0, 3);
  if (!ranked.length) throw new Error("AMLL 无匹配歌词");

  const results = await Promise.all(ranked.map(async ({ candidate, match }) => {
    try {
      const result = await getJson(`https://api.amll.dev/v1/lyrics/get?id=${encodeURIComponent(String(candidate.id))}`);
      const text = result?.data?.lyrics;
      if (typeof text !== "string" || !text.trim() || !hasTimedLyric(text)) return null;
      return resultFromMatch("amll", "ttml", text, candidate.title, match, { detail: `AMLL TTML API #${candidate.id}` });
    } catch {
      return null;
    }
  }));
  const best = results.filter((item): item is ProviderMatch => !!item).sort((left, right) => right.confidence - left.confidence)[0];
  if (!best) throw new Error("AMLL 歌词获取失败");
  return best;
}

async function fetchKugouCandidate(request: ExternalRequest, candidate: Candidate, match: MatchResult) {
  const query = new URLSearchParams({
    ver: "1",
    man: "yes",
    client: "pc",
    keyword: `${candidate.artist || ""} - ${candidate.title || request.title}`,
    hash: String(candidate.hash || candidate.id || ""),
    album_audio_id: String(candidate.albumAudioId || ""),
  });
  const candidates = await getJson(`https://krcs.kugou.com/search?${query}`);
  for (const item of Array.isArray(candidates?.candidates) ? candidates.candidates.slice(0, 5) : []) {
    if (!item?.id || !item.accesskey) continue;
    try {
      const downloaded = await getJson(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(item.id)}&accesskey=${encodeURIComponent(item.accesskey)}&fmt=krc&charset=utf8`);
      if (typeof downloaded?.content === "string" && downloaded.content) {
        return resultFromMatch("kugou", "krc", downloaded.content, candidate.title, match, { detail: `Kugou KRC ${item.id}` });
      }
    } catch {}
  }
  return null;
}

async function fetchKugou(request: ExternalRequest) {
  const search = await getJson(`https://mobileservice.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(request.title)}&page=1&pagesize=10`);
  const songs = Array.isArray(search?.data?.info) ? search.data.info : [];
  const candidates: Candidate[] = songs.map((item: any) => ({
    raw: item,
    id: item.hash,
    hash: item.hash,
    albumAudioId: item.album_audio_id,
    title: item.songname || request.title,
    artist: item.singername || "",
    durationMs: candidateDuration(item),
  }));
  const ranked = rankCandidates(request, candidates).filter((entry) => entry.match.qualified).slice(0, 3);
  if (!ranked.length) throw new Error("酷狗无匹配歌词");
  const results = await Promise.all(ranked.map(({ candidate, match }) => fetchKugouCandidate(request, candidate, match).catch(() => null)));
  const best = results.filter((item): item is ProviderMatch => !!item).sort((left, right) => right.confidence - left.confidence)[0];
  if (!best) throw new Error("酷狗歌词获取失败");
  return best;
}

async function fetchNeteaseCandidate(candidate: Candidate, match: MatchResult) {
  try {
    const lyric = await getJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(String(candidate.id))}&lv=1&kv=1&tv=-1`, { headers: { Referer: "https://music.163.com/" } });
    const text = [lyric?.lrc?.lyric, lyric?.klyric?.lyric].find((value) => hasTimedLyric(value)) || "";
    if (!hasTimedLyric(text)) return null;
    return resultFromMatch("netease", "lrc", text, candidate.title, match, {
      translation: typeof lyric?.tlyric?.lyric === "string" ? lyric.tlyric.lyric : "",
      romanization: typeof lyric?.romalrc?.lyric === "string" ? lyric.romalrc.lyric : "",
      detail: `网易云 ${candidate.id}`,
    });
  } catch {
    return null;
  }
}

async function fetchNetease(request: ExternalRequest) {
  const search = await getJson(`https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(request.title)}&type=1&offset=0&total=true&limit=10`, { headers: { Referer: "https://music.163.com/" } });
  const songs = Array.isArray(search?.result?.songs) ? search.result.songs : [];
  const candidates: Candidate[] = songs.map((item: any) => ({
    raw: item,
    id: item.id,
    title: item.name || request.title,
    artist: item.artists?.map((artist: any) => artist.name).join(" / ") || "",
    durationMs: candidateDuration(item),
  }));
  const ranked = rankCandidates(request, candidates).filter((entry) => entry.match.qualified).slice(0, 3);
  if (!ranked.length) throw new Error("网易云无匹配歌词");
  const results = await Promise.all(ranked.map(({ candidate, match }) => fetchNeteaseCandidate(candidate, match)));
  const best = results.filter((item): item is ProviderMatch => !!item).sort((left, right) => right.confidence - left.confidence)[0];
  if (!best) throw new Error("网易云歌词获取失败");
  return best;
}

async function searchCandidates(provider: ExternalProviderName, request: { title: string; artist?: string; durationMs?: number }) {
  if (provider === "amll") {
    const params = new URLSearchParams({ musicName: request.title, page: "1", pageSize: "10" });
    if (request.artist) params.set("artistName", request.artist);
    const result = await getJson(`https://api.amll.dev/v1/lyrics/search?${params}`);
    return (Array.isArray(result?.data?.items) ? result.data.items : []).slice(0, 10).map((item: any) => ({ provider, id: item.id, title: item.musicNames?.[0] || request.title, artist: item.artistNames?.join(" / ") || "" }));
  }
  if (provider === "netease") {
    const result = await getJson(`https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(request.title)}&type=1&offset=0&total=true&limit=10`, { headers: { Referer: "https://music.163.com/" } });
    return (Array.isArray(result?.result?.songs) ? result.result.songs : []).slice(0, 10).map((item: any) => ({ provider, id: item.id, title: item.name, artist: item.artists?.map((artist: any) => artist.name).join(" / ") || "", durationMs: Number(item.dt || 0) }));
  }
  const result = await getJson(`https://mobileservice.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(request.title)}&page=1&pagesize=10`);
  return (Array.isArray(result?.data?.info) ? result.data.info : []).slice(0, 10).map((item: any) => ({ provider, id: item.hash, hash: item.hash, albumAudioId: item.album_audio_id, title: item.songname, artist: item.singername, durationMs: Number(item.duration || item.interval || 0) * 1000 }));
}

async function fetchManualLyrics(item: any) {
  if (item.provider === "amll") {
    const result = await getJson(`https://api.amll.dev/v1/lyrics/get?id=${encodeURIComponent(item.id)}`);
    if (typeof result?.data?.lyrics !== "string" || !result.data.lyrics.trim()) throw new Error("AMLL 歌词为空");
    return { ok: true, source: "amll", format: "ttml", text: result.data.lyrics, matched: item.title, confidence: 100, qualified: true, debug: `手动选择 AMLL #${item.id}` };
  }
  if (item.provider === "netease") {
    const result = await getJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(item.id)}&lv=1&kv=1&tv=-1`, { headers: { Referer: "https://music.163.com/" } });
    const text = [result?.lrc?.lyric, result?.klyric?.lyric].find((value) => hasTimedLyric(value)) || "";
    if (!hasTimedLyric(text)) throw new Error("网易云歌词为空或无有效时间轴");
    return { ok: true, source: "netease", format: "lrc", text, translation: hasTimedLyric(result?.tlyric?.lyric) ? result.tlyric.lyric : "", romanization: hasTimedLyric(result?.romalrc?.lyric) ? result.romalrc.lyric : "", matched: item.title, confidence: 100, qualified: true, debug: `手动选择网易云 ${item.id}` };
  }
  const query = new URLSearchParams({ ver: "1", man: "yes", client: "pc", keyword: `${item.artist || ""} - ${item.title || ""}`, hash: item.hash || item.id, album_audio_id: String(item.albumAudioId || "") });
  const candidates = await getJson(`https://krcs.kugou.com/search?${query}`);
  const candidate = Array.isArray(candidates?.candidates) ? candidates.candidates[0] : null;
  if (!candidate?.id || !candidate.accesskey) throw new Error("酷狗歌词无匹配");
  const result = await getJson(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=krc&charset=utf8`);
  if (typeof result?.content !== "string" || !result.content) throw new Error("酷狗歌词为空");
  return { ok: true, source: "kugou", format: "krc", text: result.content, matched: item.title, confidence: 100, qualified: true, debug: `手动选择酷狗 ${candidate.id}` };
}

const providerLoaders: Record<ExternalProviderName, (request: ExternalRequest) => Promise<ProviderMatch>> = {
  amll: fetchAmlldb,
  kugou: fetchKugou,
  netease: fetchNetease,
};

async function fetchProviderCached(provider: ExternalProviderName, request: ExternalRequest) {
  const key = `${provider}|${normalizeSongKey(request)}`;
  const cached = providerCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
  const pending = providerPending.get(key);
  if (pending) return pending;
  const requestPromise = providerLoaders[provider](request).then((result) => {
    providerCache.set(key, { at: Date.now(), result });
    return result;
  }).finally(() => providerPending.delete(key));
  providerPending.set(key, requestPromise);
  return requestPromise;
}

chrome.runtime.onMessage.addListener((message: ExternalRequest | { type: string }, _sender, sendResponse) => {
  if (message.type === "getSettings") {
    chrome.storage.local.get(DEFAULT_SETTINGS).then(sendResponse).catch(() => sendResponse(DEFAULT_SETTINGS));
    return true;
  }
  if (message.type === "saveLyricDebug") {
    chrome.storage.local.set({ lastLyricDebug: (message as any).debug }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "getLyricDebug") {
    chrome.storage.local.get({ lastLyricDebug: null }).then(sendResponse).catch(() => sendResponse({ lastLyricDebug: null }));
    return true;
  }
  if (message.type === "getCacheStats") {
    chrome.storage.local.get({ lyricCache: {} }).then(({ lyricCache }) => {
      const text = JSON.stringify(lyricCache || {});
      sendResponse({ ok: true, count: lyricCache && typeof lyricCache === "object" ? Object.keys(lyricCache).length : 0, kb: Math.round(new TextEncoder().encode(text).length / 102.4) / 10 });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "clearLyricCache") {
    providerCache.clear();
    providerPending.clear();
    chrome.storage.local.remove("lyricCache").then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "searchLyrics") {
    const provider = (message as any).provider as ExternalProviderName;
    if (!["amll", "kugou", "netease"].includes(provider)) { sendResponse({ ok: false, error: "不支持的歌词来源" }); return true; }
    searchCandidates(provider, { title: String((message as any).query || ""), artist: (message as any).artist, durationMs: (message as any).durationMs }).then((items) => sendResponse({ ok: true, items })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "fetchManualLyrics") {
    fetchManualLyrics((message as any).item).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type !== "fetchProviderLyrics") return;
  const request = message as ExternalRequest;
  if (!request.provider || !["amll", "kugou", "netease"].includes(request.provider)) {
    sendResponse({ ok: false, source: "none", format: "text", text: "", debug: "不支持的歌词来源" });
    return true;
  }
  fetchProviderCached(request.provider, request).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, source: request.provider, format: "text", text: "", debug: error instanceof Error ? error.message : String(error) });
  });
  return true;
});
