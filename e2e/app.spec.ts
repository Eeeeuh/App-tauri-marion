import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.SHOTS_DIR;

async function addLink(page: Page, url: string) {
  await page.getByLabel("Lien de la série").fill(url);
  await page.keyboard.press("Enter");
}

const card = (page: Page, title: string) => page.locator(".card", { has: page.locator(".card-title", { hasText: title }) });

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto("/");
  await expect(page.locator("body.ready")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
});

test("empty state, then add a link with live preview", async ({ page }) => {
  await expect(page.getByText("Ta liste est vide")).toBeVisible();
  await expect(page.locator("#toolbar")).toBeHidden();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-empty.png` });

  const input = page.getByLabel("Lien de la série");
  await expect(input).toBeFocused();
  await input.fill("https://streaming.fr/serie/the-office/saison-2/episode-5");
  await expect(page.locator("#preview")).toContainText("The Office");
  await expect(page.locator("#preview")).toContainText("S02 · E05");
  await expect(page.locator("#preview")).toContainText("Nouvelle série");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-preview.png` });
  await page.keyboard.press("Enter");

  const c = card(page, "The Office");
  await expect(c).toBeVisible();
  await expect(c.locator("[data-kind=season]")).toHaveText("S02");
  await expect(c.locator("[data-kind=episode]")).toHaveText("E05");
  await expect(input).toHaveValue("");
  await expect(page.locator(".toast")).toContainText("ajoutée");
});

test("invalid input cannot be added", async ({ page }) => {
  await page.getByLabel("Lien de la série").fill("pas un lien");
  await expect(page.locator("#add-btn")).toBeDisabled();
  await expect(page.locator("#preview")).toContainText("pas un lien valide");
  await page.keyboard.press("Enter");
  await expect(page.locator(".card")).toHaveCount(0);
});

test("steppers, persistence across reload", async ({ page }) => {
  await addLink(page, "https://a.fr/dark/saison-1/episode-3");
  const c = card(page, "Dark");
  await c.getByLabel("Épisode suivant").click();
  await c.getByLabel("Épisode suivant").click();
  await expect(c.locator("[data-kind=episode]")).toHaveText("E05");
  await c.getByLabel("Saison suivante").click();
  await expect(c.locator("[data-kind=season]")).toHaveText("S02");
  await expect(c.locator("[data-kind=episode]")).toHaveText("E01");
  await expect(c.getByLabel("Épisode précédent")).toBeDisabled();

  await page.waitForTimeout(400); // debounce
  await page.reload();
  const c2 = card(page, "Dark");
  await expect(c2.locator("[data-kind=season]")).toHaveText("S02");
  await expect(c2.locator("[data-kind=episode]")).toHaveText("E01");
});

test("pasting a later episode updates the show instead of duplicating", async ({ page }) => {
  await addLink(page, "https://a.fr/dark/saison-1/episode-3");
  await page.getByLabel("Lien de la série").fill("https://a.fr/dark/saison-1/episode-8");
  await expect(page.locator("#preview")).toContainText("Mettra à jour « Dark »");
  await page.keyboard.press("Enter");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(card(page, "Dark").locator("[data-kind=episode]")).toHaveText("E08");
});

test("edit dialog: rename, status, note, validation", async ({ page }) => {
  await addLink(page, "https://www.netflix.com/watch/80012345");
  await card(page, "Netflix").getByTitle("Modifier").click();
  const dlg = page.locator("#editor");
  await expect(dlg).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-editor.png` });

  await dlg.getByLabel("Titre").fill("The Crown");
  await dlg.getByLabel("Lien").fill("javascript:alert(1)");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg.getByText("Ce lien n’est pas valide.")).toBeVisible();
  await expect(dlg).toBeVisible();

  await dlg.getByLabel("Lien").fill("https://www.netflix.com/watch/80012346");
  await dlg.getByLabel("Saison").fill("4");
  await dlg.getByLabel("Épisode").fill("10");
  await dlg.getByText("Terminée").click();
  await dlg.getByLabel("Note").fill("Finale incroyable");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg).toBeHidden();

  const c = card(page, "The Crown");
  await expect(c.locator("[data-kind=season]")).toHaveText("S04");
  await expect(c.locator(".status")).toHaveText("Terminée");
  await expect(c.locator(".card-note")).toHaveText("Finale incroyable");
  await expect(c.getByRole("button", { name: "Revoir" })).toBeVisible();
});

test("delete with undo", async ({ page }) => {
  await addLink(page, "https://a.fr/dark");
  await addLink(page, "https://a.fr/lost");
  await card(page, "Dark").getByTitle("Modifier").click();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(card(page, "Dark")).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(card(page, "Dark")).toBeVisible();
  await expect(page.locator(".card-title")).toHaveText(["Lost", "Dark"]);
});

test("filters, search and keyboard shortcuts", async ({ page }) => {
  await addLink(page, "https://a.fr/dark");
  await addLink(page, "https://b.fr/le-bureau-des-legendes");
  await addLink(page, "https://c.fr/fargo");
  await card(page, "Fargo").getByTitle("Modifier").click();
  await page.locator("#editor").getByText("À voir").click();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByRole("tab", { name: /Tout/ })).toContainText("3");
  await page.getByRole("tab", { name: /À voir/ }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(card(page, "Fargo").getByRole("button", { name: "Commencer" })).toBeVisible();
  await page.getByRole("tab", { name: /Tout/ }).click();

  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Control+f");
  await expect(page.locator("#search")).toBeFocused();
  await page.keyboard.type("légendes");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.keyboard.type("zzz");
  await expect(page.getByText("Aucun résultat")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".card")).toHaveCount(3);
});

test("paste anywhere fills the link field", async ({ page }) => {
  await page.locator("body").click({ position: { x: 5, y: 600 } });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "https://x.fr/severance/season-2-episode-4");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });
  await expect(page.getByLabel("Lien de la série")).toHaveValue("https://x.fr/severance/season-2-episode-4");
  await expect(page.getByLabel("Lien de la série")).toBeFocused();
  await expect(page.locator("#preview")).toContainText("Severance");
});

test("user content is rendered as text, never HTML", async ({ page }) => {
  await addLink(page, "https://a.fr/dark");
  await card(page, "Dark").getByTitle("Modifier").click();
  await page.locator("#editor").getByLabel("Titre").fill('<img src=x onerror="window.__xss=1">');
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".card-title")).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator(".card img")).toHaveCount(0);
});

test("corrupted storage does not crash the app", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("bobine.library.v1", "{broken"));
  await page.reload();
  await expect(page.getByText("Ta liste est vide")).toBeVisible();
});

test("showcase screenshots", async ({ page }) => {
  test.skip(!SHOTS, "only when SHOTS_DIR is set");
  for (const url of [
    "https://streaming.fr/serie/the-office/saison-2/episode-5",
    "https://www.netflix.com/watch/80012345",
    "https://b.fr/le-bureau-des-legendes/saison-3/episode-2",
    "https://c.fr/fargo",
    "https://x.fr/severance/season-2-episode-4",
  ])
    await addLink(page, url);
  await card(page, "Netflix").getByTitle("Modifier").click();
  await page.locator("#editor").getByLabel("Titre").fill("Dark");
  await page.locator("#editor").getByText("Terminée").click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await card(page, "Fargo").getByTitle("Modifier").click();
  await page.locator("#editor").getByText("À voir").click();
  await page.locator("#editor").getByLabel("Note").fill("Conseillée par Léa");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(3600); // let toasts fade
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}/3-list.png` });
  await page.setViewportSize({ width: 430, height: 860 });
  await page.screenshot({ path: `${SHOTS}/5-narrow.png` });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.waitForTimeout(400); // colour transitions
  await page.screenshot({ path: `${SHOTS}/6-light.png` });
});
