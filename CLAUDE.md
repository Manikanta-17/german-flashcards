# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page German vocabulary flashcard app ("German LMS"), built as one self-contained
`index.html` file with no build step, package manager, or test suite. It's a PWA (see
`manifest.json`) meant to be opened directly in a browser or installed to a home screen.

## Running / developing

There is no build process. To work on the app, just open `index.html` in a browser (or serve the
folder with any static file server, e.g. `python -m http.server`). Changes take effect on reload.
There is no linter or test suite configured — verify changes manually in the browser.

External dependencies are loaded via CDN `<script>` tags in the `<head>`, not npm:
- SheetJS (`xlsx.full.min.js`) — reads/writes the Excel workbook used for import/export.
- Firebase compat SDK (`firebase-app-compat.js`, `firebase-firestore-compat.js`) — cloud sync.

## Architecture

Everything lives in `index.html`: styles in the single `<style>` block, markup for every screen
in `<body>`, and all logic in the single `<script>` block at the bottom, organized into numbered
comment sections (`// 1. FIREBASE CONFIG`, `// 2. STATE`, `// 3. HELPERS`, etc.) — use those
section markers to navigate rather than searching blindly.

**Data model.** All vocab data lives in one in-memory object, `appData`:
- `appData[tableName]` is an array of word entries: `{ rowData, categories, comment, lastPracticed, srs }`.
  - `rowData` is a raw array of spreadsheet cell values (columns vary by section — see below).
  - `categories` is an array of user-applied tag strings (e.g. "Easy", "Difficult").
  - `srs` is the spaced-repetition state: `{ box, seen, correct, wrong, nextDue }`.
- `appData._tableOrder` is the array defining table display order (excluded from `realTables()`).
- Sibling globals `_headers` (table → column names), `_sections` (table → section name),
  `_activity` (date → practiced/learned counts), `_customCats` (section → user-added tags) are
  all synced/persisted alongside `appData` — treat them as one unit whenever loading/saving.

**Sections ("hubs").** Every table belongs to exactly one of six fixed sections defined in the
`HUBS` array: `Vocabulary`, `Verbs`, `FillBlanks`, `Sentences`, `Jumble`, `Grammar`. The section
determines which practice-mode UI panel (`#mode-<Section>`) is shown and how `rowData` columns are
interpreted (e.g. Vocabulary is `[en, de, plural/note, example]`; Verbs is
`[en, infinitive, present, past, future]`; FillBlanks is `[english sentence, german w/ ___, missing word]`).
When adding a new section, you must update: `HUBS`, `tagMaps`, `editColumns()`, the
`mode-<Section>` HTML block, `loadCard()`, `checkAnswer()`, and `entryDisplay()` — these all branch
on `currentMode`/section name and must stay in sync.

**Excel import format.** Import expects a workbook with a `Table_Index` sheet listing
`SheetName`, `TableName`, `Range`, `Section` per table (see `handleFileUpload()` and
`normSection()` for the accepted section aliases). Each table's rows are merged into `appData`
by matching the first column value, so re-importing updates existing rows rather than duplicating.

**Persistence.** `saveData()` writes to both `localStorage` (`cache_<profile>`, for offline
fallback) and Firestore (collection `vocabAppV7`, doc `data_<profile>`) — call it after any mutation
to `appData`/`_headers`/`_sections`/`_activity`/`_customCats`. Multiple named "profiles" are
supported (switch/create/delete in the top bar); each profile is a fully separate Firestore
document and localStorage cache key.

**Screens.** `showScreen(name)` toggles visibility between `main`, `practice`, `summary`, `list`,
`progress` — there is no router/history; navigation is all direct function calls
(`goHome()`, `openSection()`, `openModal()`, `initPractice()`, `exitPractice()`, etc.).

**Spaced repetition.** `SRS_INTERVALS` (days) and `updateSrs()`/`isDue()`/`isNew()` implement a
simple box-based SRS scheduler per word entry, independent of tags/categories.

**Practice sessions.** A session is a `practiceQueue` array of `{ tableName, index, mode, data }`
built by `initPractice()` (single table) or `buildSectionQueue()` (whole section, e.g. "review all
due items tagged X across every table"). `loadCard()`/`nextCard()`/`checkAnswer()` drive the
current card; grading only happens once per queue index per session (`gradedThisSession`) so
navigating back and forth doesn't double-count stats.

## Data files

- `German_Master_Vocab.xlsx` — the source vocab workbook matching the `Table_Index` import format
  described above; not read by the app at runtime, just the source data to import through the UI.
- `icon.png.png` — PWA icon referenced by `manifest.json`.
