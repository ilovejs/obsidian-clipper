# Obsidian Web Clipper – AGENTS.md

## Project Overview

This is the **Obsidian Web Clipper** browser extension. It captures web pages and saves them as Markdown notes directly into an Obsidian vault. It is a TypeScript/Webpack project that compiles to a browser extension (Chrome, Firefox, Safari).

---

## Repository Layout

```
src/
  background.ts          – Service worker: message routing, context menu, tab events
  content.ts             – Content script injected into pages
  core/
    popup.ts             – Main UI logic: clipping flow, handleClipObsidian(), template rendering
    settings.ts          – Settings page orchestration
  utils/
    obsidian-note-creator.ts  – saveToObsidian(): builds obsidian://URIs and triggers vault save
    markdown-converter.ts     – HTML → Markdown conversion (TurndownService-based); all image/figure rules live here
    content-extractor.ts      – extractPageContent() / initializePageContent(); builds {{variables}}
    string-utils.ts           – processUrls(): makes all img src / href absolute before conversion
    storage-utils.ts          – loadSettings() / saveSettings(); generalSettings singleton
    file-utils.ts             – saveFile(): browser download / Share API fallback
    image-downloader.ts        – embedImagesAsDataUris(): fetches images and converts to base64
  filters/                  – Liquid-style template filters
  types/
    types.ts             – Shared TypeScript interfaces (Template, Settings, Property, …)
  managers/
    general-settings.ts  – Settings UI
    template-manager.ts  – CRUD for templates
scripts/                 – Build/release helper scripts
webpack.config.js        – Bundles popup, background, content, settings, side-panel
```

---

## Key Flows

### Save-to-Obsidian (`handleClipObsidian`)
1. `popup.ts · handleClipObsidian()` gathers form fields (vault, path, note name, properties, content).
2. Calls `generateFrontmatter(properties)` → prepends YAML front matter.
3. Calls `saveToObsidian(fileContent, noteName, path, vault, behavior)` in `obsidian-note-creator.ts`.
4. That function builds an `obsidian://new?file=…` URI and either writes to clipboard (non-legacy) or passes content via URI (legacy mode).

### Markdown Conversion
- `createMarkdownContent(htmlContent, pageUrl)` in `markdown-converter.ts`.
- URLs are first made absolute via `processUrls()` (`string-utils.ts`).
- TurndownService rules handle tables, figures (`![alt](src)`), YouTube embeds, math, etc.
- Images currently appear as standard Markdown image links pointing to the **original remote URL**.

### Localized Image Copy
1. If `localImages.enabled` is true, `popup.ts` calls `embedImagesAsDataUris()` before saving.
2. `image-downloader.ts` extracts all remote `![]()` URLs from the markdown.
3. For each URL, it sends a `fetchImageAsBase64` message to the background script.
4. `background.ts` fetches the image (cross-origin permitted via `<all_urls>`) and returns a base64 Data URI.
5. The markdown is rewritten to embed the image directly: `![alt](data:image/png;base64,...)`.
6. This ensures the note is self-contained and immune to link-rot, regardless of vault location.

---

## Build & Dev Commands

```bash
npm install          # install dependencies
npm run build        # production build (webpack)
npm run dev          # watch mode
npm run test         # vitest unit tests
```

Compiled extension output goes into `dist/`.

---

## Conventions

- **TypeScript strict mode** – all new code must be typed.
- **No class components** – functional, module-level exports only.
- **Browser API**: always import from `./browser-polyfill` (wraps `webextension-polyfill`).
- **Settings**: read/write via `generalSettings` singleton in `storage-utils.ts`; add new fields to both `Settings` interface (`types.ts`) and `loadSettings` / `saveSettings`.
- **i18n**: user-visible strings go through `getMessage(key)` from `utils/i18n.ts` and must be added to `src/_locales/en/messages.json`.
- **No jQuery, no frameworks** – plain DOM manipulation inside popup/settings pages.
