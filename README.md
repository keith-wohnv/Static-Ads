# Static-Ads

A vibe-coded static ads generator powered by Google Gemini, FAL.ai Nano Banana 2, and Claude Code via VS Code.

Give it a brand name + website URL — it researches the brand, generates 50 ad creatives in two aspect ratios, builds an interactive gallery for picking the best images, writes Meta-ready ad copy for three funnel stages, and exports everything as an Ads Uploader CSV. End to end, one pipeline.

---

## How It Works

```
Brand Name + URL
      │
      ▼
┌──────────────────────────┐
│  Phase 1: Brand Research  │  Scrapes site, downloads images, takes screenshots,
│                           │  builds a Brand DNA document
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│  Phase 2: Prompt Gen      │  Fills 50 ad templates with brand colors,
│                           │  voice, pricing, and product details
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│  Phase 3: Image Gen       │  Sends prompts + product photos to Gemini API,
│                           │  generates 1:1 and 9:16 images, builds gallery
└───────────┬──────────────┘
            ▼
      Pick the best images in the gallery
            ▼
┌──────────────────────────┐
│  Phase 4: Ad Copy         │  Writes TOF/MOF/BOF copy using 100 hook frameworks,
│                           │  exports CSV + Excel + ad library preview
└───────────┬──────────────┘
            ▼
      Upload to Meta via Ads Uploader
```

## What You Get

- ~400 AI-generated ad images (50 templates × 4 variations × 2 aspect ratios)
- Interactive HTML gallery with image selection UI
- 150 ad copy variants (50 templates × 3 funnel stages: cold / warm / retargeting)
- Ads Uploader-compatible CSV + Excel file
- Facebook Ad Library-style preview page

---

## Tech Stack

| Component | Role |
|---|---|
| **Claude Code** | Orchestrates the pipeline — brand research, prompt generation, ad copy |
| **Google Gemini** | Primary image generation API (accepts reference product images) |
| **FAL.ai Nano Banana 2** | Backup image generator |
| **Node.js** | Generation scripts, gallery builder, file I/O |
| **VS Code** | IDE with Claude Code extension |

---

## Quick Start

### Prerequisites

- [Claude Code](https://claude.ai/code) (CLI or VS Code extension)
- [Node.js 18+](https://nodejs.org)
- [Google Gemini API key](https://aistudio.google.com) (required)
- [FAL.ai API key](https://fal.ai) (optional backup)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/keith-wohnv/Static-Ads.git
cd Static-Ads

# 2. Install dependencies
npm install

# 3. Add your API keys
cp .env.example .env
# Edit .env with your GEMINI_KEY (and optionally FAL_KEY)

# 4. Open in Claude Code
claude
```

### Run It

**Phase 1–2** (in Claude Code):
```
/static-ads mybrand https://mybrand.com "Product Name"
```

**Phase 3** (image generation):
```bash
# Full run — 50 templates, 4 images each, both ratios
node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand

# Test run — 3 templates, 1 image, one ratio (fast & cheap)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand --templates 1,7,13 --num-images 1 --ratios 1x1
```

**Phase 4** (in Claude Code, after selecting images in the gallery):
```
create copy for mybrand {version-folder}
```

---

## Project Structure

```
Static-Ads/
├── .claude/
│   ├── skills/
│   │   ├── static-ads/             # Image generation skill definition
│   │   └── ad-copy-builder/        # Ad copy skill + references
│   └── commands/                   # Slash commands
├── skills/references/
│   ├── generate_ads_gemini.mjs     # Primary generation script (Gemini)
│   ├── generate_ads.mjs            # Backup generation script (FAL.ai)
│   ├── gallery-selector.mjs        # Gallery HTML builder
│   └── ad-library.mjs              # Ad Library preview builder
├── brands/                         # Per-brand workspaces (gitignored)
├── hook-bank.md                    # 100 hook frameworks for ad copywriting
├── CLAUDE.md                       # Project instructions for Claude
├── SETUP-GUIDE.md                  # Detailed setup & usage guide
├── .env.example                    # API key template
└── package.json
```

---

## The 50 Ad Templates

Each template targets a different ad style. A few examples:

| # | Template | Style |
|---|---|---|
| 01 | Headline | Bold headline with key benefit |
| 02 | Offer/Promotion | Price-forward promotional ad |
| 03 | Testimonial/Review | Customer quote or review card |
| 05 | Problem/Solution | Pain point → solution |
| 07 | Us vs. Them | Side-by-side comparison |
| 09 | Negative Marketing | "Don't buy this if..." |

All 50 templates are defined in [.claude/skills/static-ads/SKILL.md](.claude/skills/static-ads/SKILL.md).

---

## Command Reference

```bash
# Image generation (Gemini)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name}
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name} --templates 1,7,13 --num-images 2 --ratios 1x1
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name} --max-concurrent 5

# Image generation (FAL.ai backup)
node skills/references/generate_ads.mjs --brand-dir brands/{name}

# Rebuild gallery
node skills/references/gallery-selector.mjs --output-dir brands/{name}/outputs/{version} --open
```

| Flag | Default | Description |
|---|---|---|
| `--brand-dir` | (required) | Path to the brand folder |
| `--templates` | all | Comma-separated template numbers (e.g., `1,7,13`) |
| `--num-images` | 4 | Variations per prompt per ratio |
| `--ratios` | `1x1,9x16` | Aspect ratios to generate |
| `--max-concurrent` | 2 | Parallel API requests (max recommended: 5) |

---

## How It Was Built

This entire project was vibe-coded with [Claude Code](https://claude.ai/code) inside VS Code. The pipeline, scripts, prompt templates, gallery UI, and ad copy engine were all built through conversational development — describing what I wanted and iterating with Claude until it worked.

---

## License

[MIT](LICENSE) — fully open source. Use it, fork it, build on it.
