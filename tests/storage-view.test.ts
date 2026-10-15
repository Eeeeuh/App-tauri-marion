import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver } from "../src/storage";
import { cardHtml, esc, greeting, hueOf, initials, relativeTime } from "../src/view";
import type { Show } from "../src/library";

describe("createSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces and only writes the latest value", async () => {
    const write = vi.fn(async () => {});
    const s = createSaver(write, 100);
    s.schedule("a");
    s.schedule("b");
    s.schedule("c");
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith("c");
  });

  it("flush writes immediately", async () => {
    const write = vi.fn(async () => {});
    const s = createSaver(write, 10_000);
    s.schedule("x");
    await s.flush();
    expect(write).toHaveBeenCalledWith("x");
    await s.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("never runs two writes at once and ends with the newest value", async () => {
    let active = 0;
    let maxActive = 0;
    const written: string[] = [];
    const write = vi.fn(async (d: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 50));
      written.push(d);
      active--;
    });
    const s = createSaver(write, 10);
    s.schedule("1");
    await vi.advanceTimersByTimeAsync(20); // write "1" in flight
    s.schedule("2");
    await vi.advanceTimersByTimeAsync(15); // timer fires while "1" still running
    s.schedule("3");
    await vi.advanceTimersByTimeAsync(500);
    await s.flush();
    expect(maxActive).toBe(1);
    expect(written.at(-1)).toBe("3");
  });

  it("keeps the value after a failure and retries on flush", async () => {
    const onError = vi.fn();
    let fail = true;
    const write = vi.fn(async () => {
      if (fail) throw new Error("disk");
    });
    const s = createSaver(write, 10, onError);
    s.schedule("v");
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledTimes(1);
    fail = false;
    await s.flush();
    expect(write).toHaveBeenLastCalledWith("v");
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe("view helpers", () => {
  it("escapes HTML", () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  });

  it("builds initials", () => {
    expect(initials("The Office")).toBe("TO");
    expect(initials("dark")).toBe("DA");
    expect(initials("élite")).toBe("ÉL");
    expect(initials("!!!")).toBe("?");
  });

  it("hue is stable and in range", () => {
    expect(hueOf("Dark")).toBe(hueOf("dark"));
    for (const t of ["a", "Lost", "The Office", "Élite"]) {
      expect(hueOf(t)).toBeGreaterThanOrEqual(0);
      expect(hueOf(t)).toBeLessThan(12);
    }
  });

  it("formats relative time in French", () => {
    const now = 1_700_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe("à l’instant");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("il y a 5 minutes");
    expect(relativeTime(now - 86_400_000, now)).toBe("hier");
  });

  it("greets according to the time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 9))).toBe("Bonjour");
    expect(greeting(new Date(2026, 0, 1, 15))).toBe("Bon après-midi");
    expect(greeting(new Date(2026, 0, 1, 22))).toBe("Bonsoir");
  });

  it("card markup escapes user content", () => {
    const show: Show = {
      id: "1",
      title: `<b onclick="x">Evil</b>`,
      url: "https://x.fr/a?q=\"><script>",
      season: 1,
      episode: 2,
      status: "watching",
      note: "<i>hi</i>",
      createdAt: 0,
      updatedAt: 0,
    };
    const html = cardHtml(show);
    expect(html).not.toContain("<b ");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;b onclick=&quot;x&quot;&gt;Evil&lt;/b&gt;");
    expect(html).toContain("<small>E</small>02");
  });
});
