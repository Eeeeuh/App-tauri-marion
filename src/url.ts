/**
 * Link parsing helpers: normalisation, title guessing and
 * season/episode detection from streaming-site URLs.
 */

export interface LinkInfo {
  url: string;
  host: string;
  title: string;
  season: number | null;
  episode: number | null;
}

/** Normalises user input into an http(s) URL, or returns null if it isn't one. */
export function normalizeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // A bare word ("hello") is not a link: require a dot, an IP or localhost.
  const host = parsed.hostname;
  if (!host.includes(".") && host !== "localhost" && !host.startsWith("[")) return null;
  parsed.hash = parsed.hash === "#" ? "" : parsed.hash;
  return parsed.toString();
}

/** Display host without "www.". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

const SE_PATTERNS: RegExp[] = [
  /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,4})(?![0-9])/i,
  /(?:saison|season|staffel|temporada)[\s._/=-]*(\d{1,2})[\s._/&=-]+(?:[a-z]+[\s._/&=-]+)?(?:episode|épisode|ep|e|folge|episodio|capitulo)[\s._/=-]*(\d{1,4})(?![0-9])/i,
  /(\d{1,2})x(\d{1,4})(?![0-9])/i,
];
const SEASON_ONLY = /(?:saison|season|staffel|temporada)[\s._/=-]*(\d{1,2})(?![0-9])/i;
const EPISODE_ONLY = /(?:episode|épisode|ep|folge|episodio)[\s._/=-]*(\d{1,4})(?![0-9])/i;

/** Finds season / episode numbers in a URL (path + query). */
export function detectEpisode(url: string): { season: number | null; episode: number | null } {
  let text = url;
  try {
    const u = new URL(url);
    text = decodeURIComponent(u.pathname + " " + u.search);
  } catch {
    /* keep raw */
  }
  for (const re of SE_PATTERNS) {
    const m = text.match(re);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  }
  const s = text.match(SEASON_ONLY);
  const e = text.match(EPISODE_ONLY);
  return { season: s ? Number(s[1]) : null, episode: e ? Number(e[1]) : null };
}

const NOISE = new Set([
  "watch", "stream", "streaming", "serie", "series", "séries", "tv", "show", "shows",
  "vf", "vostfr", "vost", "fr", "en", "hd", "fullhd", "4k", "online", "gratuit", "free",
  "video", "videos", "player", "embed", "title", "titles", "browse", "play", "regarder",
  "voir", "film", "films", "index", "html", "php", "www", "fr-fr", "en-us",
  "saison", "season", "episode", "épisode", "ep", "staffel", "temporada", "watching",
]);

function titleCase(s: string): string {
  return s.replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const MINOR = new Set([
  "de", "des", "du", "d", "la", "le", "les", "l", "et", "à", "au", "aux", "en", "un", "une", "sur", "pour", "par",
  "of", "the", "a", "an", "and", "in", "on", "to", "for", "at", "by", "or", "y", "el", "del", "di", "da", "von", "und",
]);

/** "le-bureau-des-legendes" → "Le Bureau des Legendes" (first word always capitalised). */
function smartCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && MINOR.has(w) ? w : titleCase(w)))
    .join(" ");
}

/** Best-effort show title from a URL; falls back to the host name. */
export function guessTitle(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const segments = u.pathname
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);

  for (const seg of segments) {
    let s = seg
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/^\d+[-_]/, "") // "123-the-office" → "the-office"
      .replace(/[-_](\d{3,})$/, ""); // trailing numeric ids
    // Cut at the season/episode marker: "the-office-saison-2-episode-3" → "the-office"
    s = s.split(/[\s._-](?:s\d{1,2}[\s._-]*e\d{1,4}|saison|season|staffel|temporada|episode|épisode|ep)(?:[\s._-]|\d|$)/i)[0] ?? "";
    const words = s
      .split(/[\s._+-]+/)
      .filter((w) => w && !NOISE.has(w.toLowerCase()) && !/^\d+$/.test(w) && !/^[a-z0-9]{12,}$/i.test(w));
    if (words.length === 0) continue;
    const title = words.join(" ");
    if (title.length >= 2) return smartCase(title);
  }

  return hostTitle(url);
}

/** Title used when nothing useful is in the path: "www.netflix.com" → "Netflix". */
export function hostTitle(url: string): string {
  const parts = hostOf(url).split(".");
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return titleCase(name ?? "");
}

export function parseLink(input: string): LinkInfo | null {
  const url = normalizeUrl(input);
  if (!url) return null;
  const { season, episode } = detectEpisode(url);
  return { url, host: hostOf(url), title: guessTitle(url), season, episode };
}
