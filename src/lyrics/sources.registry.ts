import type { SourceId } from "./types";

export type ProviderCapabilities = {
  search: boolean;
  wordByWord: boolean;
  translation: boolean;
  romanization: boolean;
};

export type ProviderDefinition = {
  id: Exclude<SourceId, "feiniu" | "none">;
  priority: number;
  label: string;
  capabilities: ProviderCapabilities;
  requestLimitPerSecond: number;
};

export const PROVIDER_REGISTRY: Record<Exclude<SourceId, "feiniu" | "none">, ProviderDefinition> = {
  amll: {
    id: "amll",
    priority: 0,
    label: "AMLL",
    capabilities: { search: true, wordByWord: true, translation: true, romanization: true },
    requestLimitPerSecond: 4,
  },
  kugou: {
    id: "kugou",
    priority: 1,
    label: "酷狗",
    capabilities: { search: true, wordByWord: true, translation: false, romanization: false },
    requestLimitPerSecond: 3,
  },
  netease: {
    id: "netease",
    priority: 2,
    label: "网易云",
    capabilities: { search: true, wordByWord: false, translation: true, romanization: true },
    requestLimitPerSecond: 3,
  },
};

export function providerLabel(id: SourceId) {
  return id === "feiniu" ? "FnMusic 自带" : id === "none" ? "无" : PROVIDER_REGISTRY[id].label;
}
