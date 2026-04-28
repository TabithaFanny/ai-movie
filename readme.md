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
```

This first step only handles project creation and `.aimovie.md` file import/inspection.
Image generation, analysis, video generation, and xlsx import will be added incrementally on top of the same core.
