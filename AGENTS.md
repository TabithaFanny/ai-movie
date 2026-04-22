# AIMovieMaker — Copilot Instructions

## Project Overview

AIMovieMaker is a **browser-based AI video production tool** that transforms text scripts into structured movie projects with AI-generated video clips, character/scene management, and sequential/interactive playback. It runs as a static SPA — no build step, no bundler — served directly from HTML files with ES module imports.

The app integrates with **KeepworkSDK** for authentication, cloud storage (`PersonalPageStore`), and LLM/image/video generation APIs (Keepwork GPT, Seedance/Seedream, Qiniu CDN).

## Architecture

### Entry Point & Pages

| File | Purpose |
|------|---------|
| `AIMovieMaker.html` | Main SPA shell — full editor UI |
| `player.html` | Standalone movie player (linear + interactive branching) |
| `index.html` | Landing/redirect page |

### Module Map (`js/`)

| File | Export(s) | Purpose |
|------|-----------|---------|
| `app.js` | `init` (side-effect) | Entry point: routing, auth, theme, global event wiring |
| `state.js` | `state`, `sdk`, `normalizeProject`, `createProject`, plot helpers | Centralized mutable application state + SDK singleton |
| `config.js` | `CONFIG`, preset accessors | Constants, API endpoints, style/env/race/language presets |
| `storage.js` | `saveProject`, `loadProject`, `deleteProjectFile`, local-mode helpers | PersonalPageStore CRUD, project serialization, undo/redo, local-dir sync, asset saving |
| `api.js` | `chat`, `genVideo`, `submitGenVideo`, `uploadTempImage`, image/video generation, `analyzeScript`, `regenerateNode`, `enhanceCharacters/Scenes/Shots` | LLM streaming, Seedance video tasks, Seedream image gen, Qiniu uploads, polling |
| `views.js` | `navigateTo`, view renderers | Screen routing and rendering (projectList, editor, breakdown, generation, preview, clipEditor) |
| `tree.js` | `buildTree`, `renderTreeHTML`, `attachTreeEvents` | Hierarchical story-tree component (characters, props, scenes, shorts, folders) |
| `prompts.js` | `PROMPTS`, `PROMPT_PRESETS`, `getPrompt`, `getPromptPresetOptions` | Versioned LLM prompt registry with multi-language and multi-style presets |
| `generate.js` | `renderGeneration`, `onGenerationUpdate`, `onStartGeneration`, `tryGenerateNext` | Batch video generation queue and UI |
| `preview.js` | `renderPreview` | Preview view for completed video clips |
| `clipeditor.js` | `ClipEditor` (default class) | Multi-track NLE: video lane + subtitle lanes, transitions, canvas overlay |
| `movieplayer.js` | `MoviePlayer` (default class) | Standalone interactive/linear movie player with branching plot support |
| `plotgraph.js` | `PlotGraph` (default class) | SVG DAG editor for interactive plot node graphs |
| `genImage.js` | `showGenImageModal` | AI image generation modal (Seedream, aspect ratio, resolution) |
| `mp4ToWebp.js` | `Mp4ToWebp` (default class) | MP4 → animated WebP / frame-sequence converter with libwebp WASM |
| `newproject.js` | `showNewProjectModal` | New project dialog with template support |
| `import.js` | `showImportProjectModal` | Import project from local `.aimovie.md` file |
| `export.js` | `showExportProjectModal` | Export project + assets to local directory |
| `global_settings.js` | `initGlobalSettings`, `showSettingsModal` | App-level defaults for chat/image/video models, API key management |
| `stats.js` | `recordLLMCall`, `recordImageCall`, `recordVideoCall`, `showStatsModal` | Usage tracking (LLM tokens, image/video calls) per project |
| `presets.js` | `PRESETS` (default) | Cinematography dropdown presets (shot type, camera, lighting, emotion) |
| `help.js` | `initHelp`, `showHelpModal` | First-use help modal |
| `utils.js` | `escapeHtml`, `showToast`, `$`, `resolveUrl`, `localBlobCache` | DOM helpers, toast notifications, local blob URL cache |
| `VoiceTypeSelector.js` | `VoiceTypeSelector` | Doubao TTS voice browser/selector modal |
| `view_chars.js` | `renderCharactersGallery` | Character gallery sub-view |
| `view_props.js` | `renderPropsGallery` | Props gallery sub-view |
| `view_scenes.js` | `renderScenesGallery` | Scenes gallery sub-view |
| `view_shorts.js` | `renderShortsGallery` | Shorts gallery sub-view |
| `view_plot_settings.js` | `renderPlotSettings` | Plot/interactive-mode settings sub-view |

### Data Flow

```
User Script
  → api.js (LLM streaming via Keepwork GPT)
  → state.js (normalizeProject → currentProject)
  → tree.js + views.js (breakdown editor)
  → api.js (Seedance video gen / Seedream image gen)
  → generate.js (batch queue, polling)
  → preview.js / clipeditor.js / movieplayer.js (playback)
  → storage.js (PersonalPageStore persistence as .aimovie.md)
```

### Persistence

- **Cloud:** Projects are JSON-serialized and stored as `{title}.aimovie.md` files in the `AIMovieMaker` workspace via `sdk.personalPageStore`. Assets (images, videos) are uploaded to Qiniu CDN or saved as base64 in Git-backed repos.
- **Local mode:** Optional local-directory sync via File System Access API (`storage.js`), with blob URL caching (`localBlobCache`).
- **Interactive plots** are exported as `.aiplot.md` for the standalone player.
- **Settings** are stored in `localStorage` under `aimm_*` keys.

## Key Data Structures

### Project Object (`.aimovie.md`)

```json
{
  "format": "aimovie",
  "project": {
    "id": "UUID",
    "title": "Movie Title",
    "synopsis": "Plot summary",
    "script": "Original script text",
    "settings": {
      "ratio": "16:9",
      "resolution": "720p",
      "model": "seedance-2.0-fast",
      "defaultDuration": 5,
      "generateAudio": true,
      "style": "3d-semirealistic",
      "language": "zh",
      "promptPreset": "default"
    },
    "characters": [
      { "id": "UUID", "name": "Name", "description": "Visual traits", "imageUrl": "...", "folderId": null }
    ],
    "props": [
      { "id": "UUID", "name": "Name", "description": "...", "imageUrl": "..." }
    ],
    "scenes": [
      { "id": "UUID", "name": "Name", "description": "Setting details", "imageUrl": "..." }
    ],
    "shorts": [
      {
        "id": "UUID", "order": 1, "prompt": "Video generation prompt",
        "duration": 5, "status": "pending|running|succeeded|failed",
        "videoUrl": null, "taskId": null, "characterIds": [], "sceneId": null,
        "dialogue": "", "narration": "", "folderId": null
      }
    ],
    "folders": [
      { "id": "UUID", "name": "Act 1", "category": "shorts|characters|scenes|props", "order": 0 }
    ],
    "plot": {
      "nodes": [{ "id": "root", "name": "Start", "shortIds": [], "choices": [] }]
    }
  }
}
```

### Short Status Lifecycle

`pending` → `running` (task submitted) → `succeeded` (video URL received) | `failed` (error)

## Coding Conventions

### Language & Style

- **Vanilla ES6+ JavaScript** — no TypeScript, no JSX, no build step.
- All source files are ES modules loaded directly by the browser (`<script type="module">`).
- **Class-based** for complex components (`ClipEditor`, `MoviePlayer`, `PlotGraph`, `Mp4ToWebp`, `VoiceTypeSelector`); **function-based** for views and utilities.
- `async/await` for all async flows. Promise constructors only where streaming/browser APIs require them.

### State Management

- Single mutable `state` object in `state.js` — no framework, no reactivity.
- Views re-render by writing to `innerHTML` and re-attaching event listeners.
- The `sdk` singleton is created once in `state.js` and shared by all modules.

### Module Dependencies

- `state.js` and `config.js` are dependency roots — imported by nearly everything.
- `views.js` is the main orchestrator; uses dynamic `import()` to break circular dependencies with `generate.js`.
- `utils.js` provides shared DOM helpers — keep it dependency-free.

### Naming

- File names: camelCase for all JS modules (`clipeditor.js`, `genImage.js`), PascalCase for standalone components (`VoiceTypeSelector.js`).
- Functions/variables: camelCase.
- Classes: PascalCase.
- Constants: UPPER_SNAKE_CASE in `config.js` and `prompts.js`.
- DOM element IDs: camelCase (accessed via `$('elementId')`).
- CSS: Tailwind utilities + custom properties (`--text-primary`, `--bg-card`, etc.).

### Storage Conventions

- Project files use the suffix `.aimovie.md` (JSON content, `.md` extension for PersonalPageStore compatibility).
- Default fields are stripped before saving to reduce file size (see `SHORT_DEFAULTS`, `CHAR_DEFAULTS`, etc. in `storage.js`).
- The workspace name is `AIMovieMaker` (constant `CONFIG.PROJECT_WORKSPACE`).

### API Patterns

- LLM calls go through `api.js → chat()` which streams responses from the Keepwork GPT endpoint.
- Video generation uses Seedance: `submitGenVideo()` → polling via `startPolling()`.
- Image generation uses Seedream via `genImageDirect()` or the `showGenImageModal()` UI.
- All uploads use Qiniu temporary or permanent buckets via `uploadTempImage()` / `saveBase64Asset()`.
- Usage stats are recorded per-call via `recordLLMCall()`, `recordImageCall()`, `recordVideoCall()`.

### UI Patterns

- Dark/light theme via `body.light` class toggle and CSS custom properties.
- Modals are created lazily via `ensureModal()` pattern — DOM element constructed once, shown/hidden.
- Toast notifications via `showToast(message, type)`.
- Mobile support: sidebar overlay pattern with `isMobile()` checks.

## Templates

- Template definitions live in `movie_templates/index.json` (registry) and individual `.aimovie.json` files.
- Templates provide pre-built project structures (characters, scenes, shorts with calibrated prompts and reference images).
- The "New Project" dialog loads and applies templates.

## Key Constraints

1. **No build step.** All JS is served as ES modules directly. Do not introduce bundlers, transpilers, or Node-only APIs in runtime code.
2. **KeepworkSDK dependency.** The SDK must be loaded before the app (`window.keepwork`). Auth, storage, and AI APIs all flow through it.
3. **Concurrency limits.** Video generation uses a queue with `CONFIG.MAX_CONCURRENT` (default 2) parallel tasks. Respect this in any batch operation.
4. **File size awareness.** Project JSON is stripped of default values before saving. Large projects can have 50+ shorts with video URLs — keep serialization efficient.
5. **Cross-origin assets.** Video/image URLs come from Qiniu CDN (`keepwork.com` domains). Local mode uses blob URLs via `localBlobCache`. Always use `resolveUrl()` when rendering asset URLs.
6. **No framework.** UI is vanilla DOM manipulation. Views re-render via `innerHTML` replacement. Do not introduce React, Vue, or similar.
7. **Prompt stability.** LLM prompts in `prompts.js` are versioned via preset keys. Changes to prompt text affect generation quality — treat them as compatibility-sensitive.
8. **Interactive plot format.** The `.aiplot.md` export and `MoviePlayer` share a contract for node/choice structure. Changes must keep the player compatible.

## Documentation

- `docs/architecture.md` — Module graph and data flow details
- `docs/design.md` — Interactive plot design ("Long Interactive Model", S-curve tension arcs)
- `docs/getting_started.md` — User guide (Chinese)
- `docs/code-plan.md` — Development planning notes
- `docs/qa-report.md` — QA test results
- `readme.md` — Project README