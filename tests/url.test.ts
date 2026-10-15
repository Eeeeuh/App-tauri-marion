import { describe, expect, it } from "vitest";
import { detectEpisode, guessTitle, hostOf, normalizeUrl, parseLink } from "../src/url";

describe("normalizeUrl", () => {
  it("keeps valid http(s) links", () => {
    expect(normalizeUrl("https://www.netflix.com/watch/8123")).toBe("https://www.netflix.com/watch/8123");
    expect(normalizeUrl("http://example.org/a?b=1")).toBe("http://example.org/a?b=1");
  });
  it("adds https when the scheme is missing and trims", () => {
    expect(normalizeUrl("  netflix.com/title/123 ")).toBe("https://netflix.com/title/123");
  });
  it("rejects garbage, other schemes and bare words", () => {
    for (const bad of ["", "   ", "hello", "not a link", "javascript:alert(1)", "file:///etc/passwd", "ftp://x.org", "data:text/html,hi"]) {
      expect(normalizeUrl(bad), bad).toBeNull();
    }
  });
  it("accepts localhost and IPs", () => {
    expect(normalizeUrl("http://localhost:8080/x")).toBe("http://localhost:8080/x");
    expect(normalizeUrl("192.168.1.2/show")).toBe("https://192.168.1.2/show");
  });
});

describe("detectEpisode", () => {
  const cases: [string, number | null, number | null][] = [
    ["https://site.tv/the-office-s02e05", 2, 5],
    ["https://site.tv/the.office.S2E5.vostfr", 2, 5],
    ["https://site.fr/serie/the-office/saison-2/episode-5", 2, 5],
    ["https://site.fr/serie/the-office-saison-3-episode-12-vf", 3, 12],
    ["https://site.com/show/the-office/season-4-episode-7", 4, 7],
    ["https://site.com/the-office/2x05", 2, 5],
    ["https://site.com/the-office/saison-3", 3, null],
    ["https://site.com/the-office/episode-9", null, 9],
    ["https://www.netflix.com/watch/80012345", null, null],
    ["https://site.com/watch?show=lost&season=2&episode=4", 2, 4],
  ];
  it.each(cases)("%s → S%s E%s", (url, s, e) => {
    expect(detectEpisode(url)).toEqual({ season: s, episode: e });
  });
});

describe("guessTitle", () => {
  it.each([
    ["https://site.fr/serie/the-office/saison-2/episode-5", "The Office"],
    ["https://site.fr/serie/the-office-saison-3-episode-12-vf", "The Office"],
    ["https://site.tv/breaking.bad.s01e01.1080p", "Breaking Bad"],
    ["https://site.com/series/1234-la-casa-de-papel", "La Casa de Papel"],
    ["https://site.com/watch/stranger-things-vostfr", "Stranger Things"],
    ["https://site.fr/s%C3%A9ries/le-bureau-des-l%C3%A9gendes", "Le Bureau des Légendes"],
    ["https://site.com/the-lord-of-the-rings-the-rings-of-power", "The Lord of the Rings the Rings of Power"],
    ["https://www.netflix.com/watch/80012345", "Netflix"],
    ["https://www.primevideo.com/", "Primevideo"],
  ])("%s → %s", (url, title) => {
    expect(guessTitle(url)).toBe(title);
  });
});

describe("parseLink / hostOf", () => {
  it("strips www from host", () => {
    expect(hostOf("https://www.arte.tv/fr")).toBe("arte.tv");
    expect(hostOf("nope")).toBe("");
  });
  it("returns everything at once", () => {
    expect(parseLink("site.fr/serie/dark/saison-1/episode-3")).toEqual({
      url: "https://site.fr/serie/dark/saison-1/episode-3",
      host: "site.fr",
      title: "Dark",
      season: 1,
      episode: 3,
    });
    expect(parseLink("pas un lien")).toBeNull();
  });
});
