# Bobine

Ta liste de séries, simple et élégante. Colle un lien, Bobine retient où tu en es.

Application de bureau **Tauri 2** (Windows, macOS, Linux) — légère (~quelques Mo), rapide, hors-ligne.

## Fonctionnalités

- **Colle un lien, c’est tout.** Le titre, la saison et l’épisode sont détectés automatiquement depuis l’URL
  (`s02e05`, `saison-2/episode-5`, `season-2-episode-5`, `2x05`, `?season=2&episode=5`…).
  Un aperçu s’affiche avant d’ajouter.
- **`Ctrl V` n’importe où** dans la fenêtre remplit le champ du lien.
- **Pas de doublons.** Coller le lien d’un épisode plus récent d’une série déjà enregistrée la met à jour.
- **Suivi saison / épisode** avec les boutons `−` / `+` (changer de saison repart à l’épisode 1).
- **Reprendre** ouvre le lien dans ton navigateur et remonte la série en haut de la liste.
- Statuts **En cours / À voir / Terminées**, recherche instantanée (insensible aux accents), notes.
- Suppression avec **Annuler**.
- **Exporter / Importer** ta liste (menu `⋯`) pour la sauvegarder ou la transférer.
- Thème sombre et clair (suit le système), animations sobres, accessible au clavier.

### Raccourcis

| Raccourci          | Action                         |
| ------------------ | ------------------------------ |
| `Ctrl V`           | Coller un lien (n’importe où)  |
| `Entrée`           | Ajouter le lien                |
| `Ctrl F` ou `/`    | Rechercher                     |
| `Ctrl L` / `Ctrl N`| Aller au champ du lien         |
| `Échap`            | Vider le champ / fermer        |

## Fiabilité

- Les données sont enregistrées dans un fichier JSON du dossier de l’application
  (`%APPDATA%\app.bobine.series` sur Windows, `~/Library/Application Support/app.bobine.series` sur macOS,
  `~/.local/share/app.bobine.series` sur Linux).
- Écriture **atomique** (fichier temporaire + `fsync` + renommage) : une coupure ne peut pas corrompre la liste.
- La version précédente est conservée dans `library.bak.json` et utilisée automatiquement si le fichier principal
  est illisible. Si rien n’est lisible, l’app **refuse d’écraser** le fichier.
- Toutes les données (fichier, import) sont validées et nettoyées avant usage ; seuls les liens `http(s)` sont acceptés.
- Sauvegarde différée et regroupée, jamais deux écritures en parallèle, et vidage forcé à la fermeture de la fenêtre.
- Une seule instance de l’app à la fois (une deuxième ouverture remet la fenêtre existante au premier plan).
- CSP stricte, aucun appel réseau, permissions Tauri minimales.

## Développement

Prérequis : [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs) et les
[dépendances système de Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # lance l’app en mode développement
npm run tauri build    # produit l’installeur dans src-tauri/target/release/bundle/
```

### Tests

```bash
npm test                         # tests unitaires (logique, parsing des liens, sauvegarde, rendu)
npm run test:e2e                 # tests de bout en bout dans Chromium (Playwright)
cd src-tauri && cargo test       # tests du stockage Rust (atomicité, sauvegarde, corruption)
```

## Structure

```
src/
  url.ts        détection titre / saison / épisode depuis un lien
  library.ts    modèle de données (fonctions pures, testées)
  storage.ts    persistance (Tauri ou localStorage) + écriture différée
  view.ts       rendu HTML échappé
  main.ts       interface et interactions
  styles.css    design
src-tauri/src/
  storage.rs    écriture atomique + backup
  lib.rs        commandes Tauri (lecture, écriture, export, import)
tests/          tests unitaires (Vitest)
e2e/            tests de bout en bout (Playwright)
```
