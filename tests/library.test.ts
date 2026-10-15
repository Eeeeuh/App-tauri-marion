import { describe, expect, it } from "vitest";
import {
  addShow,
  countByStatus,
  emptyLibrary,
  filterShows,
  mergeLibraries,
  parseLibrary,
  removeShow,
  restoreShow,
  serializeLibrary,
  stepEpisode,
  stepSeason,
  touchShow,
  updateShow,
  type Library,
} from "../src/library";

const T = 1_700_000_000_000;

function add(lib: Library, url: string, extra: Partial<Parameters<typeof addShow>[1]> = {}, now = T) {
  const res = addShow(lib, { url, ...extra }, now);
  if (res.kind === "invalid") throw new Error("invalid");
  return res;
}

describe("addShow", () => {
  it("adds a new show at the top with detected title and episode", () => {
    let lib = add(emptyLibrary(), "https://a.fr/serie/dark/saison-1/episode-3").library;
    const res = add(lib, "https://a.fr/serie/lost/saison-2/episode-4", {}, T + 1);
    expect(res.kind).toBe("added");
    lib = res.library;
    expect(lib.shows.map((s) => s.title)).toEqual(["Lost", "Dark"]);
    expect(lib.shows[0]).toMatchObject({ season: 2, episode: 4, status: "watching", createdAt: T + 1 });
  });

  it("defaults to S1 E1 when nothing is detected", () => {
    const { show } = add(emptyLibrary(), "https://www.netflix.com/watch/8001");
    expect(show).toMatchObject({ season: 1, episode: 1, title: "Netflix" });
  });

  it("rejects invalid links without touching the library", () => {
    const lib = emptyLibrary();
    const res = addShow(lib, { url: "javascript:alert(1)" });
    expect(res.kind).toBe("invalid");
    expect(res.library).toBe(lib);
  });

  it("flags the exact same link as duplicate", () => {
    const lib = add(emptyLibrary(), "https://a.fr/dark/saison-1/episode-3").library;
    const res = add(lib, "a.fr/dark/saison-1/episode-3");
    expect(res.kind).toBe("duplicate");
    expect(res.library).toBe(lib);
  });

  it("updates the existing show when pasting a later episode of it", () => {
    let lib = add(emptyLibrary(), "https://a.fr/dark/saison-1/episode-3").library;
    lib = add(lib, "https://a.fr/lost/saison-1/episode-1", {}, T + 1).library;
    lib = updateShow(lib, lib.shows[1]!.id, { status: "done" });
    const res = add(lib, "https://a.fr/dark/saison-2/episode-1", {}, T + 5);
    expect(res.kind).toBe("updated");
    expect(res.library.shows).toHaveLength(2);
    expect(res.library.shows[0]).toMatchObject({
      title: "Dark",
      season: 2,
      episode: 1,
      url: "https://a.fr/dark/saison-2/episode-1",
      status: "watching",
      updatedAt: T + 5,
    });
  });

  it("does not merge same title from different sites", () => {
    let lib = add(emptyLibrary(), "https://a.fr/dark/saison-1/episode-3").library;
    lib = add(lib, "https://b.fr/dark/saison-1/episode-3").library;
    expect(lib.shows).toHaveLength(2);
  });

  it("never merges links that only share the site name as title", () => {
    let lib = add(emptyLibrary(), "https://www.netflix.com/watch/8001").library;
    const res = add(lib, "https://www.netflix.com/watch/8002");
    expect(res.kind).toBe("added");
    lib = res.library;
    expect(lib.shows).toHaveLength(2);
  });

  it("honours an explicit title", () => {
    const { show } = add(emptyLibrary(), "https://www.netflix.com/watch/8001", { title: "  The   Crown " });
    expect(show.title).toBe("The Crown");
  });
});

describe("updateShow / steps", () => {
  const base = () => add(emptyLibrary(), "https://a.fr/dark/saison-2/episode-3").library;

  it("patches fields and ignores invalid values", () => {
    const lib = base();
    const id = lib.shows[0]!.id;
    const next = updateShow(lib, id, { title: "", url: "javascript:x", season: -4, episode: 7.9, note: "  ok  " }, T + 9);
    expect(next.shows[0]).toMatchObject({
      title: "Dark",
      url: "https://a.fr/dark/saison-2/episode-3",
      season: 1,
      episode: 7,
      note: "ok",
      updatedAt: T + 9,
    });
  });

  it("returns the same library for unknown ids", () => {
    const lib = base();
    expect(updateShow(lib, "nope", { title: "x" })).toBe(lib);
    expect(stepEpisode(lib, "nope", 1)).toBe(lib);
    expect(touchShow(lib, "nope")).toBe(lib);
  });

  it("never goes below episode 1", () => {
    let lib = base();
    const id = lib.shows[0]!.id;
    lib = stepEpisode(lib, id, -1);
    lib = stepEpisode(lib, id, -1);
    lib = stepEpisode(lib, id, -1);
    expect(lib.shows[0]!.episode).toBe(1);
  });

  it("changing season resets the episode", () => {
    let lib = base();
    const id = lib.shows[0]!.id;
    lib = stepSeason(lib, id, 1);
    expect(lib.shows[0]).toMatchObject({ season: 3, episode: 1 });
    lib = stepSeason(lib, id, -1);
    lib = stepSeason(lib, id, -1);
    lib = stepSeason(lib, id, -1);
    expect(lib.shows[0]!.season).toBe(1);
    const frozen = lib;
    expect(stepSeason(frozen, id, -1)).toBe(frozen);
  });

  it("touch moves to front and starts planned shows", () => {
    let lib = add(emptyLibrary(), "https://a.fr/dark", { status: "planned" }).library;
    lib = add(lib, "https://a.fr/lost").library;
    const darkId = lib.shows[1]!.id;
    lib = touchShow(lib, darkId, T + 50);
    expect(lib.shows[0]).toMatchObject({ id: darkId, status: "watching", updatedAt: T + 50 });
  });
});

describe("remove / restore", () => {
  it("restores at the original position and is idempotent", () => {
    let lib = emptyLibrary();
    for (const s of ["dark", "lost", "fargo"]) lib = add(lib, `https://x.fr/${s}`).library;
    expect(lib.shows).toHaveLength(3);
    const { library, removed, index } = removeShow(lib, lib.shows[1]!.id);
    expect(library.shows).toHaveLength(2);
    const back = restoreShow(library, removed!, index);
    expect(back.shows.map((s) => s.id)).toEqual(lib.shows.map((s) => s.id));
    expect(restoreShow(back, removed!, index)).toBe(back);
    expect(removeShow(lib, "nope").removed).toBeNull();
  });
});

describe("filter & count", () => {
  it("filters by status and accent-insensitive query on title/host/note", () => {
    let lib = add(emptyLibrary(), "https://a.fr/le-bureau-des-legendes").library;
    lib = add(lib, "https://netflix.com/dark", { status: "planned" }).library;
    lib = updateShow(lib, lib.shows[0]!.id, { note: "Avec Léa" });
    expect(filterShows(lib.shows, "all", "LÉGENDES").map((s) => s.title)).toEqual(["Le Bureau des Legendes"]);
    expect(filterShows(lib.shows, "all", "netflix")).toHaveLength(1);
    expect(filterShows(lib.shows, "all", "lea")).toHaveLength(1);
    expect(filterShows(lib.shows, "planned", "")).toHaveLength(1);
    expect(filterShows(lib.shows, "done", "")).toHaveLength(0);
    expect(countByStatus(lib.shows)).toEqual({ all: 2, watching: 1, planned: 1, done: 0 });
  });
});

describe("persistence", () => {
  it("round-trips through JSON", () => {
    let lib = add(emptyLibrary(), "https://a.fr/dark/saison-2/episode-3").library;
    lib = updateShow(lib, lib.shows[0]!.id, { note: "<script>alert(1)</script>", status: "done" });
    expect(parseLibrary(serializeLibrary(lib))).toEqual(lib);
  });

  it("never throws on corrupted input", () => {
    for (const raw of [null, undefined, "", "{", "null", "42", '"x"', "{}", '{"shows":"x"}', "[1,2,null]"]) {
      expect(parseLibrary(raw as string)).toEqual(emptyLibrary());
    }
  });

  it("salvages valid records and drops/repairs bad ones", () => {
    const lib = parseLibrary(
      JSON.stringify({
        shows: [
          { id: "a", url: "https://x.fr/dark", title: "Dark", season: "3", episode: 0, status: "weird", createdAt: -1 },
          { id: "a", url: "https://x.fr/lost" }, // duplicate id → regenerated
          { url: "javascript:alert(1)", title: "evil" },
          { title: "no url" },
          "string",
        ],
      }),
    );
    expect(lib.shows).toHaveLength(2);
    expect(lib.shows[0]).toMatchObject({ id: "a", title: "Dark", season: 3, episode: 1, status: "watching" });
    expect(lib.shows[1]!.id).not.toBe("a");
    expect(lib.shows[1]!.title).toBe("Lost");
  });

  it("accepts a bare array (legacy / hand-made exports)", () => {
    expect(parseLibrary('[{"url":"https://x.fr/dark"}]').shows).toHaveLength(1);
  });

  it("merges imports without duplicates", () => {
    const a = add(emptyLibrary(), "https://x.fr/dark").library;
    const b = add(add(emptyLibrary(), "https://x.fr/dark").library, "https://x.fr/lost").library;
    const { library, added } = mergeLibraries(a, b);
    expect(added).toBe(1);
    expect(library.shows.map((s) => s.title)).toEqual(["Dark", "Lost"]);
    expect(mergeLibraries(library, b).added).toBe(0);
  });
});
