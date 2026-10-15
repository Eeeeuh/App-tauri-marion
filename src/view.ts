/** Pure rendering helpers (string → HTML). Every user value goes through `esc`. */
import { icon } from "./icons";
import type { Show, Status } from "./library";
import { hostOf } from "./url";

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

export function initials(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const pick = words.length === 1 ? [...words[0]!].slice(0, 2).join("") : [...words[0]!][0]! + [...words[1]!][0]!;
  return pick.toUpperCase();
}

/** Stable colour slot (0–11) derived from the title. */
export function hueOf(title: string): number {
  let h = 0;
  for (const ch of title.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 12;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "à l’instant";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

export const STATUS_LABEL: Record<Status, string> = {
  watching: "En cours",
  planned: "À voir",
  done: "Terminée",
};

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function cardHtml(show: Show, now = Date.now()): string {
  const host = hostOf(show.url);
  const playLabel = show.status === "planned" ? "Commencer" : show.status === "done" ? "Revoir" : "Reprendre";
  const note = show.note ? `<p class="card-note" title="${esc(show.note)}">${esc(show.note)}</p>` : "";
  return `
  <div class="mono h-${hueOf(show.title)}" aria-hidden="true">${esc(initials(show.title))}</div>
  <div class="card-info">
    <h3 class="card-title" title="${esc(show.title)}">${esc(show.title)}</h3>
    <p class="card-meta">
      <span class="status status-${show.status}">${STATUS_LABEL[show.status]}</span>
      <span class="sep">·</span><span class="host">${esc(host)}</span>
      <span class="sep">·</span><span class="when">${esc(relativeTime(show.updatedAt, now))}</span>
    </p>
    ${note}
  </div>
  <div class="progress" aria-label="Progression">
    <div class="stepper">
      <button type="button" class="step" data-action="season-" aria-label="Saison précédente" ${show.season <= 1 ? "disabled" : ""}>${icon("minus", 14)}</button>
      <span class="step-value" data-kind="season"><small>S</small>${pad2(show.season)}</span>
      <button type="button" class="step" data-action="season+" aria-label="Saison suivante">${icon("plus", 14)}</button>
    </div>
    <div class="stepper">
      <button type="button" class="step" data-action="episode-" aria-label="Épisode précédent" ${show.episode <= 1 ? "disabled" : ""}>${icon("minus", 14)}</button>
      <span class="step-value" data-kind="episode"><small>E</small>${pad2(show.episode)}</span>
      <button type="button" class="step" data-action="episode+" aria-label="Épisode suivant">${icon("plus", 14)}</button>
    </div>
  </div>
  <div class="card-actions">
    <button type="button" class="btn btn-play" data-action="open" title="${esc(show.url)}">${icon("play", 14)}<span>${playLabel}</span></button>
    <button type="button" class="icon-btn" data-action="edit" aria-label="Modifier ${esc(show.title)}" title="Modifier">${icon("edit", 16)}</button>
  </div>`;
}

/** Signature used to skip re-rendering unchanged cards. */
export const cardKey = (s: Show, now: number) =>
  `${s.title}|${s.url}|${s.season}|${s.episode}|${s.status}|${s.note}|${relativeTime(s.updatedAt, now)}`;

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Bonjour";
  if (h >= 12 && h < 18) return "Bon après-midi";
  return "Bonsoir";
}
