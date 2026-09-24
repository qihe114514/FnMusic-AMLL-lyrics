import type { AmllQueryVariant, SongQuery } from "./types.ts";
import { toSimplified } from "./normalize.ts";

const RAW_ARTIST_SPLIT = /[\s,，、/&＆;；+·・|]+|(?:feat(?:uring)?|ft\.?|with)\s*/gi;

function rawArtists(query: SongQuery) {
  const values = query.artists?.length ? query.artists : [];
  return values.map((item) => item.trim()).filter(Boolean);
}

function splitRawArtists(value: string) {
  return String(value)
    .replace(RAW_ARTIST_SPLIT, "\n")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAmllQueryVariants(query: SongQuery): AmllQueryVariant[] {
  const variants: AmllQueryVariant[] = [];
  const seen = new Set<string>();
  const title = query.title.trim();
  const artists = rawArtists(query);
  const fullArtist = artists.length ? artists.join(" / ") : "";

  const add = (musicName: string, artistName?: string) => {
    const cleanTitle = musicName.trim();
    if (!cleanTitle) return;
    const key = `${cleanTitle.toLowerCase()}|${(artistName || "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ musicName: cleanTitle, artistName: artistName?.trim() || undefined });
  };

  // 1. full artist string
  if (fullArtist) add(title, fullArtist);

  // 2. each individual artist
  const individual = artists.flatMap((item) => splitRawArtists(item));
  for (const artist of individual.slice(0, 4)) add(title, artist);

  // 3. simplified title variant (traditional -> simplified)
  const simplified = toSimplified(title);
  if (simplified !== title) {
    if (fullArtist) add(simplified, fullArtist);
    for (const artist of individual.slice(0, 2)) add(simplified, artist);
  }

  // 4. title only, last
  add(title);

  return variants;
}

export function buildKugouKeyword(query: SongQuery) {
  return query.title.trim();
}

export function buildNeteaseKeyword(query: SongQuery) {
  return query.title.trim();
}
