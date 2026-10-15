/**
 * Library model: pure, immutable operations on the list of shows.
 * Everything here is side-effect free and fully unit tested.
 */
import { hostOf, hostTitle, parseLink } from "./url";

export type Status = "watching" | "planned" | "done";
export const STATUSES: readonly Status[] = ["watching", "planned", "done"];

export interface Show {
  id: string;
  title: string;
  url: string;
  season: number;
  episode: number;
  status: Status;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Library {
  version: 1;
  shows: Show[];
}

export const emptyLibrary = (): Library => ({ version: 1, shows: [] });

export const MAX_TITLE = 120;
export const MAX_NOTE = 500;
const MAX_NUM = 9999;

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const clampInt = (v: unknown, min: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_NUM, Math.max(min, Math.trunc(n)));
};

const cleanText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Validates one untrusted record. Returns null when it can't be salvaged. */
export function sanitizeShow(raw: unknown, now = Date.now()): Show | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const info = typeof r.url === "string" ? parseLink(r.url) : null;
  if (!info) return null;
  const status = STATUSES.includes(r.status as Status) ? (r.status as Status) : "watching";
  const createdAt = clampTime(r.createdAt, now);
  return {
    id: typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64 ? r.id : newId(),
    title: cleanText(r.title, MAX_TITLE) || info.title || info.host,
    url: info.url,
    season: clampInt(r.season, 1, 1),
    episode: clampInt(r.episode, 1, 1),
    status,
    note: typeof r.note === "string" ? r.note.trim().slice(0, MAX_NOTE) : "",
    createdAt,
    updatedAt: Math.max(createdAt, clampTime(r.updatedAt, createdAt)),
  };
}

function clampTime(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 8.64e15 ? v : fallback;
}

/** Parses persisted / imported JSON. Never throws: bad data yields an empty library. */
export function parseLibrary(json: string | null | undefined): Library {
  if (!json) return emptyLibrary();
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return emptyLibrary();
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { shows?: unknown }).shows)
      ? (data as { shows: unknown[] }).shows
      : [];
  const seen = new Set<string>();
  const shows: Show[] = [];
  for (const item of list) {
    const show = sanitizeShow(item);
    if (!show) continue;
    if (seen.has(show.id)) show.id = newId();
    seen.add(show.id);
    shows.push(show);
  }
  return { version: 1, shows };
}

export const serializeLibrary = (lib: Library): string => JSON.stringify(lib);

/** Key used to recognise the same show across different episode links. */
export function showKey(title: string, url: string): string {
  const t = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${hostOf(url)}|${t}`;
}

export type AddResult =
  | { kind: "added"; library: Library; show: Show }
  | { kind: "updated"; library: Library; show: Show }
  | { kind: "duplicate"; library: Library; show: Show }
  | { kind: "invalid"; library: Library };

export interface AddInput {
  url: string;
  title?: string;
  season?: number | null;
  episode?: number | null;
  status?: Status;
}

/**
 * Adds a link. If the same show (same site + same title) already exists,
 * it is updated to the new link/episode instead of being duplicated.
 */
export function addShow(lib: Library, input: AddInput, now = Date.now()): AddResult {
  const info = parseLink(input.url);
  if (!info) return { kind: "invalid", library: lib };
  const title = cleanText(input.title, MAX_TITLE) || info.title || info.host;
  const season = input.season ?? info.season;
  const episode = input.episode ?? info.episode;

  const exact = lib.shows.find((s) => s.url === info.url);
  if (exact) return { kind: "duplicate", library: lib, show: exact };

  // Only merge on a real title: two links that both fall back to the site
  // name ("Netflix") are not the same show.
  const key = title !== hostTitle(info.url) ? showKey(title, info.url) : null;
  const same = key ? lib.shows.find((s) => showKey(s.title, s.url) === key) : undefined;
  if (same) {
    const updated: Show = {
      ...same,
      url: info.url,
      season: season != null ? clampInt(season, 1, same.season) : same.season,
      episode: episode != null ? clampInt(episode, 1, same.episode) : same.episode,
      status: same.status === "done" ? "watching" : same.status,
      updatedAt: now,
    };
    return { kind: "updated", library: replace(lib, updated, true), show: updated };
  }

  const show: Show = {
    id: newId(),
    title,
    url: info.url,
    season: clampInt(season, 1, 1),
    episode: clampInt(episode, 1, 1),
    status: input.status ?? "watching",
    note: "",
    createdAt: now,
    updatedAt: now,
  };
  return { kind: "added", library: { ...lib, shows: [show, ...lib.shows] }, show };
}

function replace(lib: Library, show: Show, toFront = false): Library {
  const rest = lib.shows.filter((s) => s.id !== show.id);
  if (toFront) return { ...lib, shows: [show, ...rest] };
  return { ...lib, shows: lib.shows.map((s) => (s.id === show.id ? show : s)) };
}

export type ShowPatch = Partial<Pick<Show, "title" | "url" | "season" | "episode" | "status" | "note">>;

/** Applies a validated patch. Invalid URLs / empty titles are ignored. */
export function updateShow(lib: Library, id: string, patch: ShowPatch, now = Date.now()): Library {
  const cur = lib.shows.find((s) => s.id === id);
  if (!cur) return lib;
  const next: Show = { ...cur, updatedAt: now };
  if (patch.title !== undefined) next.title = cleanText(patch.title, MAX_TITLE) || cur.title;
  if (patch.url !== undefined) next.url = parseLink(patch.url)?.url ?? cur.url;
  if (patch.season !== undefined) next.season = clampInt(patch.season, 1, cur.season);
  if (patch.episode !== undefined) next.episode = clampInt(patch.episode, 1, cur.episode);
  if (patch.status !== undefined && STATUSES.includes(patch.status)) next.status = patch.status;
  if (patch.note !== undefined) next.note = patch.note.trim().slice(0, MAX_NOTE);
  return replace(lib, next);
}

export function stepEpisode(lib: Library, id: string, delta: number, now = Date.now()): Library {
  const cur = lib.shows.find((s) => s.id === id);
  if (!cur) return lib;
  return updateShow(lib, id, { episode: cur.episode + delta }, now);
}

export function stepSeason(lib: Library, id: string, delta: number, now = Date.now()): Library {
  const cur = lib.shows.find((s) => s.id === id);
  if (!cur) return lib;
  const season = clampInt(cur.season + delta, 1, cur.season);
  if (season === cur.season) return lib;
  // New season starts back at episode 1.
  return updateShow(lib, id, { season, episode: 1 }, now);
}

/** Marks as recently watched: bumps it to the top and to "watching". */
export function touchShow(lib: Library, id: string, now = Date.now()): Library {
  const cur = lib.shows.find((s) => s.id === id);
  if (!cur) return lib;
  const next: Show = { ...cur, updatedAt: now, status: cur.status === "planned" ? "watching" : cur.status };
  return replace(lib, next, true);
}

export function removeShow(lib: Library, id: string): { library: Library; removed: Show | null; index: number } {
  const index = lib.shows.findIndex((s) => s.id === id);
  if (index < 0) return { library: lib, removed: null, index };
  return { library: { ...lib, shows: lib.shows.filter((s) => s.id !== id) }, removed: lib.shows[index]!, index };
}

export function restoreShow(lib: Library, show: Show, index: number): Library {
  if (lib.shows.some((s) => s.id === show.id)) return lib;
  const shows = [...lib.shows];
  shows.splice(Math.max(0, Math.min(index, shows.length)), 0, show);
  return { ...lib, shows };
}

export type Filter = "all" | Status;

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterShows(shows: readonly Show[], filter: Filter, query: string): Show[] {
  const q = fold(query.trim());
  return shows.filter(
    (s) =>
      (filter === "all" || s.status === filter) &&
      (!q || fold(s.title).includes(q) || fold(hostOf(s.url)).includes(q) || fold(s.note).includes(q)),
  );
}

export function countByStatus(shows: readonly Show[]): Record<Filter, number> {
  const c: Record<Filter, number> = { all: shows.length, watching: 0, planned: 0, done: 0 };
  for (const s of shows) c[s.status]++;
  return c;
}

/** Imports another library, skipping shows already present (same URL or id). */
export function mergeLibraries(base: Library, incoming: Library): { library: Library; added: number } {
  const ids = new Set(base.shows.map((s) => s.id));
  const urls = new Set(base.shows.map((s) => s.url));
  const extra = incoming.shows.filter((s) => !ids.has(s.id) && !urls.has(s.url));
  return { library: { ...base, shows: [...base.shows, ...extra] }, added: extra.length };
}
