import { lowFrequencyVolume } from "./audio-level";

const post = (trackGUID: string, payload: unknown) => window.postMessage({ source: "fnmusic-amll", trackGUID, payload }, "*");
const observedMedia = new WeakSet<HTMLMediaElement>();
let activeMedia: HTMLMediaElement | null = null;
let fftRange: [number, number] = [80, 2000];
type AudioContextWithWebkit = typeof AudioContext & { new(): AudioContext };
type AudioMonitor = { context: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; raf: number };
const audioMonitors = new WeakMap<HTMLMediaElement, AudioMonitor>();
const knownAnalysers = new Set<AnalyserNode>();
const analyserBuffers = new WeakMap<AnalyserNode, Uint8Array<ArrayBuffer>>();
let analyserPollRaf = 0;
const installAnalyserHook = () => {
  try {
    const ctor = (window.AudioContext || (window as typeof window & { webkitAudioContext?: AudioContextWithWebkit }).webkitAudioContext) as AudioContextWithWebkit | undefined;
    const prototype = ctor?.prototype as (AudioContextWithWebkit["prototype"] & { __fnmusicAmllCreateAnalyser?: typeof AudioContext.prototype.createAnalyser }) | undefined;
    if (!prototype || prototype.__fnmusicAmllCreateAnalyser) return;
    const originalCreateAnalyser = prototype.createAnalyser;
    prototype.__fnmusicAmllCreateAnalyser = originalCreateAnalyser;
    prototype.createAnalyser = function(this: AudioContext) {
      const analyser = originalCreateAnalyser.call(this);
      knownAnalysers.add(analyser);
      return analyser;
    };
  } catch {}
};
const postPlayback = (media: HTMLMediaElement, lowFreqVolume?: number) => {
  if (media !== activeMedia || !Number.isFinite(media.currentTime)) return;
  window.postMessage({
    source: "fnmusic-amll-playback",
    currentTimeMs: Math.round(media.currentTime * 1000),
    durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : 0,
    playing: !media.paused && !media.ended,
    lowFreqVolume,
  }, "*");
};
const startAudioMonitor = (media: HTMLMediaElement) => {
  if (audioMonitors.has(media)) {
    void audioMonitors.get(media)?.context.resume().catch(() => {});
    return;
  }
  let context: AudioContext | null = null;
  try {
    const AudioContextCtor = (window.AudioContext || (window as typeof window & { webkitAudioContext?: AudioContextWithWebkit }).webkitAudioContext) as AudioContextWithWebkit | undefined;
    if (!AudioContextCtor) return;
    const contextInstance = new AudioContextCtor();
    context = contextInstance;
    const analyser = contextInstance.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    let stream: MediaStream | null = null;
    try {
      if (typeof (media as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream === "function") {
        stream = (media as HTMLMediaElement & { captureStream: () => MediaStream }).captureStream();
      }
    } catch {}
    if (stream?.getAudioTracks().length) {
      const source = contextInstance.createMediaStreamSource(stream);
      const sink = contextInstance.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(contextInstance.destination);
    } else {
      const source = contextInstance.createMediaElementSource(media);
      source.connect(analyser);
      analyser.connect(contextInstance.destination);
    }
    const monitor: AudioMonitor = { context: contextInstance, analyser, data, raf: 0 };
    audioMonitors.set(media, monitor);
    const tick = () => {
      if (activeMedia === media && !media.paused && !media.ended) {
        monitor.analyser.getByteFrequencyData(monitor.data);
        const lowFreqVolume = lowFrequencyVolume(monitor.data, contextInstance.sampleRate, monitor.analyser.fftSize, fftRange[0], Math.min(fftRange[1], fftRange[0] + 40));
        postPlayback(media, lowFreqVolume);
      }
      monitor.raf = requestAnimationFrame(tick);
    };
    monitor.raf = requestAnimationFrame(tick);
    void contextInstance.resume().catch(() => {});
  } catch {
    // Some players already own the media element's Web Audio source.
    void context?.close().catch(() => {});
  }
};
const pollSiteAnalyser = () => {
  if (activeMedia && !activeMedia.paused && !activeMedia.ended && !audioMonitors.has(activeMedia)) {
    let volume: number | undefined;
    for (const analyser of knownAnalysers) {
      const data = analyserBuffers.get(analyser) || new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyserBuffers.set(analyser, data);
      analyser.getByteFrequencyData(data);
      volume = lowFrequencyVolume(data, analyser.context.sampleRate, analyser.fftSize, fftRange[0], Math.min(fftRange[1], fftRange[0] + 40));
    }
    if (volume !== undefined) postPlayback(activeMedia, volume);
  }
  analyserPollRaf = requestAnimationFrame(pollSiteAnalyser);
};
installAnalyserHook();
analyserPollRaf = requestAnimationFrame(pollSiteAnalyser);
const observeMedia = (media: HTMLMediaElement) => {
  activeMedia = media;
  startAudioMonitor(media);
  if (observedMedia.has(media)) { postPlayback(media); return; }
  observedMedia.add(media);
  const activate = () => { activeMedia = media; startAudioMonitor(media); postPlayback(media); };
  media.addEventListener("play", activate);
  media.addEventListener("playing", activate);
  media.addEventListener("timeupdate", () => postPlayback(media));
  media.addEventListener("seeking", () => postPlayback(media));
  media.addEventListener("seeked", () => postPlayback(media));
  media.addEventListener("pause", () => postPlayback(media));
  media.addEventListener("ended", () => postPlayback(media));
};
const originalPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function(this: HTMLMediaElement) { observeMedia(this); return originalPlay.call(this); };
window.addEventListener("play", (event) => {
  if (event.target instanceof HTMLMediaElement) observeMedia(event.target);
}, true);
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "fnmusic-amll-audio-config") return;
  const from = Number(event.data.fftFrom);
  const to = Number(event.data.fftTo);
  if (Number.isFinite(from) && Number.isFinite(to) && from >= 1 && to > from) fftRange = [from, to];
});
const findTrackGuid = (value: unknown): string => { if (!value || typeof value !== "object") return ""; const object = value as Record<string, unknown>; for (const key of ["trackGUID", "trackGuid"]) if (typeof object[key] === "string" && object[key]) return object[key] as string; for (const child of Object.values(object)) { const found = findTrackGuid(child); if (found) return found; } return ""; };
const inspect = (url: string, payload: unknown, body = "") => { if (!url.includes("/music/api/v1/lyric/list")) return; const queryGuid = new URL(url, location.href).searchParams.get("trackGUID") || ""; const bodyGuid = body.match(/trackGUID[=:][\"']?([A-Za-z0-9_-]+)/)?.[1] || ""; const trackGUID = queryGuid || bodyGuid || findTrackGuid(payload); if (trackGUID) post(trackGUID, payload); };
const originalFetch = window.fetch; window.fetch = async (...args) => { const response = await originalFetch(...args); try { const request = args[0] instanceof Request ? args[0] : null; const url = request?.url || String(args[0]); inspect(url, await response.clone().json(), request?.url || ""); } catch {} return response; };
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) { (this as any).__fnmusicUrl = String(url); return (originalOpen as any).apply(this, [method, url, ...rest]); };
XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) { this.addEventListener("load", () => { try { inspect((this as any).__fnmusicUrl || "", JSON.parse(this.responseText), typeof body === "string" ? body : ""); } catch {} }); return originalSend.call(this, body); };
