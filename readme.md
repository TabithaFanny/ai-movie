# AI Movie Maker

Turn any script or story into a series of AI-generated short video clips using Seedance video generation.

## How to Use

1. Open `index.html` in a browser (or serve via a local HTTP server)
2. Log in with your Keepwork account
3. Create a new project and paste your script
4. Click "AI 分析剧本" to break the script into characters, scenes, and shorts
5. Review and edit the breakdown — adjust prompts, upload reference images
6. Click "开始生成视频" to batch-generate all short clips
7. Preview the completed movie with sequential playback

## Features

- **AI Script Analysis** — Automatically extracts characters, scenes, and short clips from text
- **Visual Breakdown Editor** — Edit characters, scenes, and individual shot prompts
- **Reference Images** — Upload images for characters and scenes to guide video generation
- **Batch Generation** — Generates up to 2 videos concurrently via Seedance API
- **Progress Tracking** — Real-time status for each short (pending/running/succeeded/failed)
- **Movie Preview** — Continuous playback of all generated clips in order
- **Workspace Project Files** — All project settings are saved into `projectname.aimovie.md` files inside the `AIMovieMaker` PersonalPageStore workspace
- **Workspace Listing** — Existing projects are discovered by listing all `*.aimovie.md` files in that workspace
- **Reference Images** — Uploaded reference images use Keepwork temporary upload URLs and are stored in the project file metadata

## Tech Stack

- Single HTML file (no build step)
- Tailwind CSS (CDN)
- keepworkSDK (auth + persistence)
- Seedance API (video generation)
- Keepwork GPT API (script analysis)

## CLI (Step 1)

The repository now includes an initial CLI layer for project-file workflows.

Examples:

```bash
node cli/aimm.mjs create "My Brand Film"
node cli/aimm.mjs inspect ./My\ Brand\ Film.aimovie.md
node cli/aimm.mjs import-aimovie ./existing.aimovie.md ./copied-project.aimovie.md
node cli/aimm.mjs import-xlsx ./storyboard.xlsx ./storyboard.aimovie.md
node cli/aimm.mjs set-stage ./storyboard.aimovie.md generating generating
node cli/aimm.mjs set-shot-status ./storyboard.aimovie.md 8 running
node cli/aimm.mjs set-shot-status ./storyboard.aimovie.md 8 succeeded https://example.com/video.mp4
```

The CLI currently supports:

- project creation
- `.aimovie.md` import / inspection
- first-pass storyboard `.xlsx` import
- project stage updates for agent workflows
- per-shot status updates for agent workflows

The current xlsx importer assumes a storyboard-style sheet where:

- row 1 is a document title
- row 2 is headers
- row 3+ contains concept rows and shot rows
- columns follow the pattern:
  `时间段 | 章节名称 | 镜头号 | 画面 | 画面参考 | 字幕 | 旁白 | 背景音效/音乐`

Image generation, analysis, and video generation will be added incrementally on top of the same core.

## Agent-first direction

The CLI is being evolved as an agent-operable runtime, not only a human convenience layer.
The intended workflow is:

- agent advances the project through CLI/core operations
- `.aimovie.md` remains the durable source of truth
- frontend reads and visualizes the updated project state
