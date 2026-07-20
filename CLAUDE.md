# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page German learning app ("German LMS"), built as one self-contained `index.html` file
with no build step, package manager, or test suite. It's a PWA (see `manifest.json`) meant to be
opened directly in a browser or installed to a home screen.

It is **not** a general-purpose flashcard app. It is a personal training tool for one learner with
a specific goal: **A2 → B2 in reading, writing, grammar and listening within 5 months, plus C1-level
speaking confidence for professional use.** The learner is a technical project manager working in
renewable energy, energy auditing, energy management and sustainability. Every feature decision
should be judged against that goal.

Two consequences follow from this, and they drive most of the architecture below:

1. **Production beats recognition.** Recognition modes (multiple choice, flip-the-card) are cheap
   to build and don't move the needle at B2+. Prefer modes that force the learner to *produce*
   German — speak it, type it, reorder it, complete it.
2. **Domain vocabulary is first-class.** Generic A2 wordlists are a small part of this. The bulk of
   the value is `Wechselrichter`, `Jahresarbeitszahl`, `Lastgang`, `Amortisationszeit` — and the
   sentence patterns used to discuss them in meetings.

## Running / developing

There is no build process. To work on the app, just open `index.html` in a browser (or serve the
folder with any static file server, e.g. `python -m http.server`). Changes take effect on reload.
There is no linter or test suite configured — verify changes manually in the browser.

External dependencies are loaded via CDN `<script>` tags in the `<head>`, not npm:
- SheetJS (`xlsx.full.min.js`) — reads/writes the Excel workbook used for import/export.
- Firebase compat SDK (`firebase-app-compat.js`, `firebase-firestore-compat.js`) — cloud sync.

Browser APIs used directly, with no dependency and no API key:
- `SpeechSynthesis` (`de-DE` voice) — text-to-speech for the Listening hub and for pronouncing any
  card on demand.
- `SpeechRecognition` / `webkitSpeechRecognition` (`lang = 'de-DE'`) — speech-to-text for the
  Speaking hub. **Chrome/Edge only.** Every call site must feature-detect and degrade to a
  type-your-answer fallback rather than throwing.

Deployed to GitHub Pages. There is no server, so there is no safe place to keep a secret — see
"AI grading" below.

## Architecture

Everything lives in `index.html`: styles in the single `<style>` block, markup for every screen
in `<body>`, and all logic in the single `<script>` block at the bottom, organized into numbered
comment sections (`// 1. FIREBASE CONFIG`, `// 2. STATE`, `// 3. HELPERS`, etc.) — use those
section markers to navigate rather than searching blindly.

### Data model

All vocab data lives in one in-memory object, `appData`:

- `appData[tableName]` is an array of word entries:
  `{ rowData, categories, level, domain, grammarTopic, comment, lastPracticed, srs }`.
  - `rowData` is a raw array of spreadsheet cell values (columns vary by section — see below).
  - `categories` is an array of user-applied tag strings (e.g. "Easy", "Difficult").
  - `level` is the CEFR band: `A2 | B1 | B2 | C1`. Defaults to the table's level when absent.
  - `domain` is the professional subject area, one of: `Solar`, `Wind`, `Speicher`, `Effizienz`,
    `Audit`, `EMS`, `Reporting`, `Projektmanagement`, `Allgemein`. Defaults to `Allgemein`.
  - `grammarTopic` is an optional key linking the entry to a grammar unit (see "Grammar
    progression"). Used mainly by Grammar and Sentences entries.
  - `srs` is the spaced-repetition state: `{ box, seen, correct, wrong, nextDue }`.
- `appData._tableOrder` is the array defining table display order (excluded from `realTables()`).
- Sibling globals — all synced/persisted alongside `appData`, treat them as one unit whenever
  loading or saving:
  - `_headers` (table → column names)
  - `_sections` (table → section name)
  - `_activity` (date → practiced/learned counts)
  - `_customCats` (section → user-added tags)
  - `_plan` (the 5-month curriculum — see "Curriculum layer")
  - `_speaking` (date → seconds spoken, scenario attempts, self-scores)

`level`, `domain` and `grammarTopic` are **additive and optional**. Entries imported before these
fields existed must keep working: read them through accessors that supply defaults
(`entryLevel(e)`, `entryDomain(e)`) rather than touching the properties directly.

### Sections ("hubs")

Every table belongs to exactly one of nine fixed sections defined in the `HUBS` array. The section
determines which practice-mode UI panel (`#mode-<Section>`) is shown and how `rowData` columns are
interpreted.

| Hub | `rowData` columns | Trains |
| --- | --- | --- |
| `Vocabulary` | `[en, de, plural/note, example]` | Recall, gender, plural |
| `Verbs` | `[en, infinitive, present, past, future]` | Conjugation |
| `FillBlanks` | `[english sentence, german w/ ___, missing word]` | Case, prepositions, connectors |
| `Sentences` | `[en sentence, de sentence, note]` | Full-sentence production |
| `Jumble` | `[en, de sentence, note]` | Word order, Verbendstellung |
| `Grammar` | `[prompt, answer, explanation]` | Explicit rule drilling |
| `Listening` | `[de audio text, en meaning, note]` | Comprehension from audio |
| `Speaking` | `[prompt/situation, target german, key phrases]` | Pronunciation, fluency |
| `Scenario` | `[role, situation, your turn, model answer, must-use phrases]` | Professional performance |

**When adding or changing a section, all of these must stay in sync** — they all branch on
`currentMode`/section name: `HUBS`, `tagMaps`, `editColumns()`, the `mode-<Section>` HTML block,
`loadCard()`, `checkAnswer()`, `entryDisplay()`, and `normSection()`'s alias table.

**The three production hubs** are where this app differs from a flashcard app, and they should get
the most care:

- **`Listening`** — `SpeechSynthesis` speaks column 0 in `de-DE`; the learner types what they heard.
  Grade by normalised string comparison (strip punctuation, case-fold, collapse whitespace, treat
  `ß`/`ss` and umlaut/`ae` spellings as equal). Offer replay at 1.0× and 0.75× rate. Never show the
  German text before the answer is submitted.
- **`Speaking`** — show the prompt, record via `SpeechRecognition`, diff the transcript against the
  target. Report word-level hits/misses rather than a pass/fail, because recognition is noisy;
  the learner is the final judge. Log seconds spoken to `_speaking` — time-on-mic is the metric
  that actually predicts speaking fluency, so surface it prominently on the progress screen.
- **`Scenario`** — a multi-turn professional roleplay (kickoff meeting, client update, audit
  reporting, site inspection, vendor negotiation, risk assessment, sustainability strategy, team
  leadership). Shows the role and situation, learner responds free-text or by voice, then the model
  answer and the must-use phrases are revealed for comparison. See "AI grading".

### AI grading

Scenario answers are open-ended and can't be graded by string comparison. The app supports an
optional Anthropic API key that the learner pastes into settings and which is stored in
`localStorage` only (key: `apiKey_<profile>`). It is never synced to Firestore and never committed.

**Grading must be a strict enhancement, not a dependency.** With no key set, the Scenario hub still
works end to end: reveal the model answer, let the learner self-score 1–5 against a shown rubric
(task completion, grammar, vocabulary range, register), and write that score to `srs`. Any code
path that assumes a key exists is a bug.

When a key is present, grade with `claude-sonnet-4-6` against the same four-part rubric, ask for
JSON only, and parse defensively — fall back to self-scoring on any parse or network failure.

### Curriculum layer

`_plan` holds the 5-month schedule and is what turns a pile of tables into a course. Shape:

```
_plan = {
  startDate: "2026-01-15",
  weeks: [
    { n: 1, level: "A2", grammarTopic: "perfekt",
      domains: ["Allgemein", "Solar"],
      days: [
        { type: "intensive", scenario: "kickoff_intro", focus: "..." },
        ...5 intensive, then 2 review
      ] }
  ]
}
```

Rules the plan generator must respect:

- **5 intensive days + 2 review days per week.** Review days build a queue from due SRS items only
  and add no new material.
- **An intensive day is a mixed queue**, not a single hub — roughly: 15 vocabulary (weighted to the
  week's `domains`), 20 grammar/fill-blank items on the week's `grammarTopic`, 10 listening,
  1 scenario. Build it in `buildDayQueue()`, alongside the existing `buildSectionQueue()`.
- **Level ramps over time**, not all at once: weeks 1–4 consolidate A2, 5–12 push B1, 13–22 push B2.
  Speaking material runs one band *above* the reading/writing band throughout — that's how the
  C1-speaking goal gets met.
- The home screen shows the current week and day and offers one primary button that starts it.
  Everything else on the home screen is secondary to that button.

### Grammar progression

`grammarTopic` values follow a fixed A2→B2 order; the plan walks them in sequence and the SRS
recirculates earlier ones. Do not reorder without reason:

`perfekt` → `praeteritum` → `dativ_akkusativ` → `wechselpraepositionen` → `adjektivdeklination` →
`nebensaetze` → `relativsaetze` → `passiv` → `passiv_modal` → `konjunktiv2` → `n_deklination` →
`nominalisierung` → `konnektoren` → `partizipialkonstruktionen` → `funktionsverbgefuege`

The last four are the B2/C1 markers that make technical German sound native — `die Inbetriebnahme
der Anlage`, `in Betrieb genommen werden`, `unter Berücksichtigung der Lastspitzen`. Weight them
heavily from week 13.

### Excel import format

Import expects a workbook with a `Table_Index` sheet listing `SheetName`, `TableName`, `Range`,
`Section` per table (see `handleFileUpload()` and `normSection()` for the accepted section aliases).

Two optional columns may be added to `Table_Index`: `Level` and `Domain`, which set the default
`level`/`domain` for every row in that table. Per-row overrides may appear as trailing columns in
the sheet itself. Both are optional — a workbook without them imports exactly as before.

Each table's rows are merged into `appData` by matching the first column value, so re-importing
updates existing rows rather than duplicating. **Merging must never clobber learner-owned state:**
`srs`, `categories`, `comment` and `lastPracticed` survive re-import; only `rowData` and the
metadata columns are overwritten.

### Persistence

`saveData()` writes to both `localStorage` (`cache_<profile>`, for offline fallback) and Firestore
(collection `vocabAppV7`, doc `data_<profile>`) — call it after any mutation to `appData`,
`_headers`, `_sections`, `_activity`, `_customCats`, `_plan` or `_speaking`. Multiple named
"profiles" are supported (switch/create/delete in the top bar); each profile is a fully separate
Firestore document and localStorage cache key.

Known failure mode: cross-browser sync breaks when Firestore security rules block writes, or when
profile names differ between browsers (profiles live in `localStorage`, so they don't travel).
Check both before debugging sync logic.

### Screens

`showScreen(name)` toggles visibility between `main`, `practice`, `summary`, `list`, `progress` —
there is no router/history; navigation is all direct function calls (`goHome()`, `openSection()`,
`openModal()`, `initPractice()`, `exitPractice()`, etc.). Use the `showScreen()` state machine
rather than toggling `display` on individual containers; doing the latter caused a class of
layout bugs that the state machine exists to prevent.

Navigation deliberately skips a CEFR-level layer — clicking a hub goes straight to its tables.
Level is a filter, not a level of the hierarchy.

### Spaced repetition

`SRS_INTERVALS` is `[0, 1, 3, 7, 16, 35]` days across five boxes. `updateSrs()`/`isDue()`/`isNew()`
implement a simple box-based scheduler per word entry, independent of tags, level and domain.

### Practice sessions

A session is a `practiceQueue` array of `{ tableName, index, mode, data }` built by
`initPractice()` (single table), `buildSectionQueue()` (whole section, e.g. "review all due items
tagged X across every table"), or `buildDayQueue()` (the curriculum's mixed daily session).
`loadCard()`/`nextCard()`/`checkAnswer()` drive the current card; grading only happens once per
queue index per session (`gradedThisSession`) so navigating back and forth doesn't double-count
stats.

## Conventions

- **German UI labels for German concepts.** Hub and grammar-topic names shown to the learner should
  use the German term (`Konjunktiv II`, not "subjunctive 2") — incidental exposure is free practice.
  App chrome stays in English.
- **Articles are colour-coded** everywhere a noun appears: `der` = blue, `die` = red, `das` = orange.
  Not green — it disappears into the card background.
- **Keyboard first.** `←`/`→` navigate cards, `Enter` submits. New modes must honour this.
- Everything stays in one file. No build step, no framework, no npm.

## Data files

- `German_Master_Vocab.xlsx` — the source vocab workbook matching the `Table_Index` import format
  described above; not read by the app at runtime, just the source data to import through the UI.
- `German_Starter_Data.xlsx` — a small reference workbook demonstrating the correct import format,
  including the optional example-sentence column for vocabulary (column D).
- `icon.png.png` — PWA icon referenced by `manifest.json`.
