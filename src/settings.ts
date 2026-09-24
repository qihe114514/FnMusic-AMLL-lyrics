export const PROVIDER_PRIORITY = ["amll", "kugou", "netease", "feiniu"] as const;
export type ProviderName = (typeof PROVIDER_PRIORITY)[number];
export type ExternalProviderName = Exclude<ProviderName, "feiniu">;

export type Settings = {
  fontSize: number;
  lyricSizePreset: string;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: string;
  blur: boolean;
  scale: boolean;
  spring: boolean;
  showTranslation: boolean;
  showRomanization: boolean;
  swapTranslationRomanization: boolean;
  wordFadeWidth: number;
  offset: number;
  backgroundRenderer: string;
  backgroundRenderScale: number;
  backgroundFps: number;
  backgroundStaticMode: boolean;
  fftFrom: number;
  fftTo: number;
  externalLyricsEnabled: boolean;
  useAmlldb: boolean;
  useKugou: boolean;
  useNetease: boolean;
  showDebug: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
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

export const SOURCE_TIMEOUT_MS = 3000;
export const CACHE_TTL_MS = 10 * 60 * 1000;
