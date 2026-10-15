import "./styles.css";
import { hydrateIcons, icon } from "./icons";
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
  type Filter,
  type Library,
  type Show,
  type Status,
} from "./library";
import { createSaver, exportFile, importFileNative, isTauri, loadRaw, openExternal, saveRaw } from "./storage";
import { cardHtml, cardKey, esc, greeting, hueOf, initials, pad2 } from "./view";
import { parseLink } from "./url";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const els = {
  greeting: $("#greeting"),
  adder: $<HTMLFormElement>("#adder"),
  input: $<HTMLInputElement>("#link-input"),
  addBtn: $<HTMLButtonElement>("#add-btn"),
  preview: $("#preview"),
  toolbar: $("#toolbar"),
  tabs: $("#tabs"),
  search: $<HTMLInputElement>("#search"),
  list: $("#list"),
  empty: $("#empty"),
  editor: $<HTMLDialogElement>("#editor"),
  editorForm: $<HTMLFormElement>("#editor-form"),
  deleteBtn: $<HTMLButtonElement>("#delete-btn"),
  toasts: $("#toasts"),
  menu: $("#menu"),
  menuBtn: $<HTMLButtonElement>("#menu-btn"),
  menuPop: $("#menu-pop"),
  importFile: $<HTMLInputElement>("#import-file"),
};

let lib: Library = emptyLibrary();
let filter: Filter = "all";
let query = "";
let editingId: string | null = null;
let canSave = false; // stays false if loading failed, so we never overwrite data we couldn't read

const saver = createSaver(saveRaw, 150, (err) => {
  console.error(err);
  toast("La sauvegarde a échoué. Nouvelle tentative à la prochaine modification.", { tone: "error" });
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// WebKitGTK can crash on View Transitions in some rendering modes
// (e.g. WEBKIT_DISABLE_COMPOSITING_MODE=1): keep them off in the Linux webview.
const viewTransitions = !(isTauri() && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent));

function commit(next: Library, { animate = false } = {}): void {
  if (next === lib) return;
  lib = next;
  if (canSave) saver.schedule(serializeLibrary(lib));
  type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  if (animate && viewTransitions && doc.startViewTransition && !reducedMotion.matches) {
    // A newer transition skips the previous one, which rejects its promises: that's expected.
    const vt = doc.startViewTransition(render);
    for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p?.catch(() => {});
  } else render();
}

/* ───────────────────────── Rendering ───────────────────────── */

const cardCache = new Map<string, { el: HTMLElement; key: string }>();

function render(): void {
  const now = Date.now();
  const counts = countByStatus(lib.shows);
  const hasShows = lib.shows.length > 0;

  els.toolbar.hidden = !hasShows;
  els.tabs.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((tab) => {
    const f = tab.dataset.filter as Filter;
    tab.setAttribute("aria-selected", String(f === filter));
    tab.querySelector(".count")!.textContent = String(counts[f]);
  });

  // Keep focus on the same control across re-renders (keyboard users).
  const active = document.activeElement as HTMLElement | null;
  const focusCard = active?.closest<HTMLElement>(".card")?.dataset.id;
  const focusAction = active?.dataset.action;

  const visible = filterShows(lib.shows, filter, query);
  const alive = new Set(visible.map((s) => s.id));
  for (const [id, entry] of cardCache) {
    if (!alive.has(id)) {
      entry.el.remove();
      cardCache.delete(id);
    }
  }

  let prev: Element | null = null;
  for (const show of visible) {
    const key = cardKey(show, now);
    let entry = cardCache.get(show.id);
    if (!entry) {
      const el = document.createElement("article");
      el.className = "card";
      el.dataset.id = show.id;
      el.style.viewTransitionName = `c-${show.id.replace(/[^a-z0-9-]/gi, "")}`;
      entry = { el, key: "" };
      cardCache.set(show.id, entry);
    }
    if (entry.key !== key) {
      entry.el.innerHTML = cardHtml(show, now);
      entry.el.classList.toggle("is-done", show.status === "done");
      entry.key = key;
    }
    const expected: Element | null = prev ? prev.nextElementSibling : els.list.firstElementChild;
    if (expected !== entry.el) els.list.insertBefore(entry.el, expected);
    prev = entry.el;
  }

  if (focusCard && focusAction && !active?.isConnected) {
    const target = cardCache.get(focusCard)?.el.querySelector<HTMLElement>(`[data-action="${focusAction}"]`);
    (target && !(target as HTMLButtonElement).disabled ? target : cardCache.get(focusCard)?.el.querySelector<HTMLElement>("[data-action='open']"))?.focus();
  }

  els.empty.hidden = visible.length > 0;
  if (!hasShows) {
    els.empty.innerHTML = `
      <div class="empty-art">${icon("film", 28)}</div>
      <h2>Ta liste est vide</h2>
      <p>Colle le lien d’une série au-dessus pour la garder sous la main.<br/>Astuce : <kbd class="kbd">Ctrl V</kbd> fonctionne n’importe où.</p>`;
  } else if (visible.length === 0) {
    els.empty.innerHTML = query
      ? `<h2>Aucun résultat</h2><p>Rien ne correspond à « ${esc(query)} ».</p>`
      : `<h2>Rien ici pour l’instant</h2><p>Aucune série dans cette catégorie.</p>`;
  }
}

function flash(id: string): void {
  const el = cardCache.get(id)?.el;
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("flash");
  el.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

/* ───────────────────────── Adding links ───────────────────────── */

function updatePreview(): void {
  const raw = els.input.value.trim();
  const info = raw ? parseLink(raw) : null;
  els.addBtn.disabled = !info;
  els.adder.classList.toggle("is-invalid", !!raw && !info);
  if (!raw) {
    els.preview.innerHTML = "";
    els.preview.classList.remove("show");
    return;
  }
  if (!info) {
    els.preview.innerHTML = `<span class="preview-hint">Ce n’est pas un lien valide.</span>`;
    els.preview.classList.add("show");
    return;
  }
  // addShow is pure: a dry run tells exactly what Enter will do.
  const dry = addShow(lib, { url: raw });
  const se =
    info.season != null || info.episode != null
      ? `<span class="chip">S${pad2(info.season ?? 1)} · E${pad2(info.episode ?? 1)}</span>`
      : "";
  const action =
    dry.kind === "duplicate"
      ? "Déjà dans ta liste"
      : dry.kind === "updated"
        ? `Mettra à jour « ${esc(dry.show.title)} »`
        : "Nouvelle série";
  els.preview.innerHTML = `
    <span class="mono mono-sm h-${hueOf(info.title)}">${esc(initials(info.title))}</span>
    <span class="preview-title">${esc(info.title)}</span>${se}
    <span class="preview-host">${esc(info.host)}</span>
    <span class="preview-action">${action} <kbd class="kbd">Entrée</kbd></span>`;
  els.preview.classList.add("show");
}

function submitLink(): void {
  const res = addShow(lib, { url: els.input.value });
  if (res.kind === "invalid") {
    els.adder.classList.remove("shake");
    void els.adder.offsetWidth;
    els.adder.classList.add("shake");
    return;
  }
  els.input.value = "";
  updatePreview();
  const visibleNow = (s: Show) => (filter === "all" || s.status === filter) && !query;
  if (!visibleNow(res.show)) {
    filter = "all";
    query = "";
    els.search.value = "";
  }
  commit(res.library, { animate: true });
  flash(res.show.id);
  const name = `« ${res.show.title} »`;
  if (res.kind === "added") toast(`${name} ajoutée`, { tone: "success" });
  else if (res.kind === "updated")
    toast(`${name} → S${pad2(res.show.season)} E${pad2(res.show.episode)}`, { tone: "success" });
  else toast(`${name} est déjà dans ta liste`);
}

/* ───────────────────────── Editor ───────────────────────── */

function field<T extends HTMLInputElement | HTMLTextAreaElement>(name: string): T {
  return els.editorForm.elements.namedItem(name) as T;
}

function openEditor(id: string): void {
  const show = lib.shows.find((s) => s.id === id);
  if (!show) return;
  editingId = id;
  field<HTMLInputElement>("title").value = show.title;
  field<HTMLInputElement>("url").value = show.url;
  field<HTMLInputElement>("season").value = String(show.season);
  field<HTMLInputElement>("episode").value = String(show.episode);
  field<HTMLTextAreaElement>("note").value = show.note;
  els.editorForm.querySelectorAll<HTMLInputElement>('input[name="status"]').forEach((r) => {
    r.checked = r.value === show.status;
  });
  setUrlError(false);
  els.editor.showModal();
  field<HTMLInputElement>("title").select();
}

function setUrlError(on: boolean): void {
  els.editorForm.querySelector<HTMLElement>('[data-error="url"]')!.hidden = !on;
  field<HTMLInputElement>("url").setAttribute("aria-invalid", String(on));
}

function saveEditor(): boolean {
  if (!editingId) return true;
  const url = field<HTMLInputElement>("url").value;
  if (!parseLink(url)) {
    setUrlError(true);
    field<HTMLInputElement>("url").focus();
    return false;
  }
  const status = (els.editorForm.querySelector<HTMLInputElement>('input[name="status"]:checked')?.value ?? "watching") as Status;
  commit(
    updateShow(lib, editingId, {
      title: field<HTMLInputElement>("title").value,
      url,
      season: Number(field<HTMLInputElement>("season").value),
      episode: Number(field<HTMLInputElement>("episode").value),
      status,
      note: field<HTMLTextAreaElement>("note").value,
    }),
  );
  return true;
}

function deleteShow(id: string): void {
  const { library, removed, index } = removeShow(lib, id);
  if (!removed) return;
  commit(library, { animate: true });
  toast(`« ${removed.title} » supprimée`, {
    action: "Annuler",
    onAction: () => {
      commit(restoreShow(lib, removed, index), { animate: true });
      flash(removed.id);
    },
  });
}

/* ───────────────────────── Toasts ───────────────────────── */

interface ToastOpts {
  tone?: "success" | "error";
  action?: string;
  onAction?: () => void;
  duration?: number;
}

function toast(message: string, opts: ToastOpts = {}): void {
  const el = document.createElement("div");
  el.className = `toast${opts.tone ? ` toast-${opts.tone}` : ""}`;
  el.setAttribute("role", opts.tone === "error" ? "alert" : "status");
  const iconName = opts.tone === "success" ? "check" : opts.tone === "error" ? "x" : null;
  el.innerHTML = `${iconName ? `<span class="toast-icon">${icon(iconName, 14)}</span>` : ""}<span class="toast-msg">${esc(message)}</span>`;
  let timer: ReturnType<typeof setTimeout>;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  if (opts.action && opts.onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = opts.action;
    btn.addEventListener("click", () => {
      opts.onAction!();
      close();
    });
    el.append(btn);
  }
  els.toasts.append(el);
  while (els.toasts.children.length > 3) els.toasts.firstElementChild!.remove();
  timer = setTimeout(close, opts.duration ?? (opts.action ? 6000 : 3200));
}

/* ───────────────────────── Import / export ───────────────────────── */

async function doExport(): Promise<void> {
  try {
    if (await exportFile(JSON.stringify(lib, null, 2))) toast("Liste exportée", { tone: "success" });
  } catch (err) {
    console.error(err);
    toast("Export impossible", { tone: "error" });
  }
}

function applyImport(raw: string): void {
  const incoming = parseLibrary(raw);
  if (incoming.shows.length === 0) {
    toast("Ce fichier ne contient aucune série valide", { tone: "error" });
    return;
  }
  const { library, added } = mergeLibraries(lib, incoming);
  commit(library, { animate: true });
  toast(added ? `${added} série${added > 1 ? "s" : ""} importée${added > 1 ? "s" : ""}` : "Tout était déjà dans ta liste", {
    tone: added ? "success" : undefined,
  });
}

async function doImport(): Promise<void> {
  if (!isTauri()) {
    els.importFile.click();
    return;
  }
  try {
    const raw = await importFileNative();
    if (raw !== null) applyImport(raw);
  } catch (err) {
    console.error(err);
    toast("Import impossible", { tone: "error" });
  }
}

/* ───────────────────────── Events ───────────────────────── */

function setMenu(open: boolean): void {
  els.menuPop.hidden = !open;
  els.menuBtn.setAttribute("aria-expanded", String(open));
  if (open) els.menuPop.querySelector<HTMLElement>("button")?.focus();
}

function bind(): void {
  els.input.addEventListener("input", updatePreview);
  els.adder.addEventListener("submit", (e) => {
    e.preventDefault();
    submitLink();
  });
  els.adder.addEventListener("animationend", () => els.adder.classList.remove("shake"));

  els.tabs.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-filter]");
    if (!tab) return;
    filter = tab.dataset.filter as Filter;
    render();
  });
  els.tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = [...els.tabs.querySelectorAll<HTMLButtonElement>("[data-filter]")];
    const i = tabs.findIndex((t) => t.dataset.filter === filter);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!;
    filter = next.dataset.filter as Filter;
    render();
    next.focus();
  });

  els.search.addEventListener("input", () => {
    query = els.search.value;
    render();
  });

  els.list.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    const id = btn?.closest<HTMLElement>(".card")?.dataset.id;
    if (!btn || !id) return;
    const show = lib.shows.find((s) => s.id === id);
    if (!show) return;
    switch (btn.dataset.action) {
      case "open":
        openExternal(show.url).catch((err) => {
          console.error(err);
          toast("Impossible d’ouvrir le lien", { tone: "error" });
        });
        commit(touchShow(lib, id), { animate: true });
        break;
      case "edit":
        openEditor(id);
        break;
      case "episode+":
        commit(stepEpisode(lib, id, 1));
        break;
      case "episode-":
        commit(stepEpisode(lib, id, -1));
        break;
      case "season+":
        commit(stepSeason(lib, id, 1));
        break;
      case "season-":
        commit(stepSeason(lib, id, -1));
        break;
    }
  });

  els.editorForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (saveEditor()) els.editor.close();
  });
  field<HTMLInputElement>("url").addEventListener("input", () => setUrlError(false));
  els.editor.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => els.editor.close()));
  els.editor.addEventListener("click", (e) => {
    if (e.target === els.editor) els.editor.close(); // backdrop click
  });
  els.editor.addEventListener("close", () => {
    const id = editingId;
    editingId = null;
    if (id) cardCache.get(id)?.el.querySelector<HTMLElement>("[data-action='edit']")?.focus();
  });
  els.deleteBtn.addEventListener("click", () => {
    const id = editingId;
    els.editor.close();
    if (id) deleteShow(id);
  });

  els.menuBtn.addEventListener("click", () => setMenu(els.menuPop.hidden));
  els.menuPop.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    setMenu(false);
    if (action === "export") void doExport();
    if (action === "import") void doImport();
  });
  document.addEventListener("click", (e) => {
    if (!els.menuPop.hidden && !els.menu.contains(e.target as Node)) setMenu(false);
  });
  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = "";
    if (file) applyImport(await file.text());
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement;
    const typing = target.matches("input, textarea, [contenteditable]");
    if (els.editor.open) return;
    if (e.key === "Escape") {
      if (!els.menuPop.hidden) {
        setMenu(false);
        els.menuBtn.focus();
      } else if (target === els.search && els.search.value) {
        els.search.value = "";
        query = "";
        render();
      } else if (target === els.input && els.input.value) {
        els.input.value = "";
        updatePreview();
      } else if (typing) target.blur();
      return;
    }
    if (mod && e.key.toLowerCase() === "f" && !els.toolbar.hidden) {
      e.preventDefault();
      els.search.focus();
      els.search.select();
    } else if (mod && (e.key.toLowerCase() === "l" || e.key.toLowerCase() === "n")) {
      e.preventDefault();
      els.input.focus();
      els.input.select();
    } else if (!typing && !mod && e.key === "/") {
      e.preventDefault();
      (els.toolbar.hidden ? els.input : els.search).focus();
    }
  });

  // Paste a link anywhere → it lands in the link field.
  document.addEventListener("paste", (e) => {
    const target = e.target as HTMLElement;
    if (els.editor.open || target.matches("input, textarea, [contenteditable]")) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text.trim()) return;
    e.preventDefault();
    els.input.value = text.trim();
    els.input.focus();
    updatePreview();
  });

  // Refresh relative times & greeting.
  setInterval(() => {
    els.greeting.textContent = greeting();
    render();
  }, 60_000);

  window.addEventListener("pagehide", () => void saver.flush());
}

async function bindWindowClose(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  // Make sure the latest change is on disk before the window goes away.
  await getCurrentWindow().onCloseRequested(async () => {
    await saver.flush();
  });
}

async function init(): Promise<void> {
  hydrateIcons(document);
  els.greeting.textContent = greeting();
  bind();
  try {
    lib = parseLibrary(await loadRaw());
    canSave = true;
  } catch (err) {
    console.error(err);
    toast("Impossible de lire ta liste. Les modifications ne seront pas enregistrées.", { tone: "error", duration: 10000 });
  }
  render();
  document.body.classList.add("ready");
  void bindWindowClose().catch(console.error);
  els.input.focus();
}

void init();
