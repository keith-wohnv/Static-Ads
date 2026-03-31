# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Automated static ad generator: Claude Code + Google Gemini (primary) / FAL.ai Nano Banana 2 (backup). Takes brand name + URL, researches the brand, generates 50 ad prompts, fires them to the image generation API, downloads images, and builds an HTML gallery. Based on Alex Cooper's framework.

## Key Files

- `.claude/skills/static-ads/SKILL.md` — Canonical skill definition (3-phase pipeline + 50 prompt templates)
- `.claude/commands/static-ads.md` — Synced copy of SKILL.md for slash command invocation
- `skills/references/generate_ads_gemini.mjs` — **Primary** Node.js generation script (Google Gemini API)
- `skills/references/generate_ads.mjs` — **Backup** Node.js generation script (FAL.ai API)
- `skills/references/gallery-selector.mjs` — Standalone script: scans output folder → builds gallery.html with radio-button image selection UI → exports `selections.json`
- `.claude/skills/ad-copy-builder/SKILL.md` — Ad copy skill: reads selections.json + brand-dna.md + hook-bank.md → writes Ads Uploader CSV
- `.claude/commands/ad-copy-builder.md` — Slash command copy of ad-copy-builder skill
- `hook-bank.md` — 100 hook frameworks from Hook Bank (D-Double-U Media), tagged by type/awareness/goal
- `brands/{name}/` — Per-brand workspace: `product-images/`, `brand-images/`, `brand-dna.md`, `prompts.json`, `outputs/`

## 4-Phase Pipeline

1. **Phase 1 (Brand DNA)**: Firecrawl scrapes brand site + screenshots → Claude visually inspects screenshots (primary color source) → web research → `brand-dna.md` + `brand-images/`
2. **Phase 2 (Prompts)**: Fill 50 templates from SKILL.md with brand details → `prompts.json`
3. **Phase 3 (Images)**: `node generate_ads_gemini.mjs` → Gemini API → `outputs/{date}-V{n}/` + `gallery.html` (with image selection UI)
4. **Phase 4 (Ad Copy)**: Open `gallery.html` → pick best image per group → Save Selections → drop `selections.json` in output folder → `create copy for [brand] [version]` → `upload.csv` + `upload-2.xlsx` + `copy-summary.md` → upload to Ads Uploader → publish paused

## Commands

```bash
# === PRIMARY: Google Gemini ===

# Full run (all 50 templates, 4 images each, both aspect ratios)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name}

# Cheap test run
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name} --templates 1,7,13 --num-images 1 --ratios 1x1

# Specific templates
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name} --templates 1,4,7,9,13 --num-images 4

# Control parallelism (default: 2, recommended: 5)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/{name} --max-concurrent 5

# === BACKUP: FAL.ai (if Gemini is down) ===

# Full run (~$48.00)
node skills/references/generate_ads.mjs --brand-dir brands/{name}

# Cheap test run
node skills/references/generate_ads.mjs --brand-dir brands/{name} --templates 1,7,13 --num-images 1 --resolution 1K
```

## Google Gemini API (Primary)

- **Model**: `gemini-3.1-flash-image-preview` — image editing model, accepts reference images as base64 inline
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent`
- **Auth**: `x-goog-api-key` query param or header — GEMINI_KEY stored in `.env`
- **Input**: prompt as text part + reference images as `inline_data` (base64) parts, `responseModalities: ["TEXT", "IMAGE"]`
- **Output**: Response `candidates[0].content.parts` — look for `inlineData` with base64 image
- Reference images from `product-images/` are loaded as base64 at startup (no CDN upload needed)
- Per-prompt `reference_images` array in prompts.json selects specific files; if empty, all images sent
- Aspect ratio controlled via prompt text (no explicit API parameter)
- One image per API call — script loops for `num-images`

## FAL API (Backup)

- **Model**: `fal-ai/nano-banana-2/edit` — always use `/edit` so reference images are passed
- **Queue URL**: `POST https://queue.fal.run/fal-ai/nano-banana-2/edit`
- **Auth**: `Authorization: Key {FAL_KEY}` — FAL_KEY stored in `.env`
- Product images uploaded to FAL CDN at startup, URLs passed with every request
- Cost: ~$0.08/img at 1K, ~$0.12 at 2K, ~$0.16 at 4K (doubled for dual aspect ratios)

## Script Behavior (both scripts)

- Generates **both 1:1 and 9:16** aspect ratios for every prompt automatically
- **9:16 Meta safe zones**: 9:16 images automatically get a safe zone instruction appended — top ~15% and bottom ~25% kept clear of text/logos for Meta Stories/Reels UI overlay compliance
- Parallel job execution with semaphore-based concurrency limiter (`--max-concurrent`)
- Outputs organized as `outputs/{date}-V{n}/{num}-{template-name}/{1x1,9x16}/`
- Builds `gallery.html` with dark-theme image selection UI (radio buttons, expand icon, Save Selections button → `selections.json`)
- `prompts.json` supports per-prompt `reference_images` array (filenames from `product-images/`)

## Gallery Selector (Rebuild / Fix Empty Gallery)

If `gallery.html` is missing or empty for an existing output folder, rebuild it:

```bash
node skills/references/gallery-selector.mjs --output-dir brands/{name}/outputs/{version} --open
```

## Ad Copy Commands

```bash
# Rebuild gallery.html for an existing output folder
node skills/references/gallery-selector.mjs --output-dir brands/{name}/outputs/{version} --open

# After saving selections.json into the output folder:
# "create copy for {brand} {version}"
# Outputs: brands/{name}/outputs/{version}/upload.csv + copy-summary.md
```

## Ad-uploads Image Naming Rule

**Always strip `_v#` from image filenames** when copying to `Ad-uploads/`. The version suffix from image generation (e.g., `_v2`, `_v3`) causes 1x1 and 9x16 variants to have mismatched names, which prevents Meta/Ads Uploader from pairing them as placement variants on the same ad.

- `headline_1x1_v2.jpg` → `headline_1x1.jpg`
- `headline_9x16_v3.jpg` → `headline_9x16.jpg`

Strip with: `filename.replace(/_v\d+(?=\.\w+$)/, '')`

Also: `rebuild-upload-csv.mjs` expects the old dual-row CSV format — do NOT use it with the current funnel CSV (3 rows per template with both image columns). Build `Ad-uploads/`, `upload-3.csv`, and `upload-2.xlsx` inline instead. See ad-copy-builder SKILL.md Phase 5 for the correct workflow.

## ~~Telehealth Compliance (All Brands)~~ — EXAMPLE: modify or remove for your brand

~~All brands are telehealth businesses with licensed medical providers. Ad copy must:~~
~~- Never reference brand-name medications (Wegovy, Ozempic, Mounjaro, etc.)~~
~~- Use "compounded medication" language + "compounded in the USA at FDA-regulated facilities"~~
~~- Never guarantee outcomes or use "rapid/effortless" weight loss language~~
~~- Matrix Reformed pricing: always "starting at $99/mo" — never flat monthly (annual plan, $1,188/year upfront)~~
~~- Full rules: `.claude/skills/ad-copy-builder/references/compliance.md`~~

> **How to customize:** Replace the section above with your own brand's compliance rules, pricing disclaimers, and ad copy constraints. The compliance.md reference file should also be updated. If your brand has no special compliance requirements, delete this section entirely.

## Environment Constraints

- Node.js 18+ required (uses built-in `fetch`, `parseArgs`)
- ~~**Python is NOT installed** — always use Node.js for scripts~~ — modify based on your environment
- ~~No npm packages — script is zero-dependency~~ — one dependency: `xlsx` (install with `npm install`)
- ~~Windows 11, running inside VS Code with Claude Code~~ — modify based on your environment

## Brand Research Rules

- **Screenshots are the primary source of truth** for brand colors and visual identity. Text-scraped CSS is secondary. If screenshots and CSS disagree, trust the screenshots.
- Use Firecrawl for site scraping and screenshots
- Always visually inspect downloaded screenshots with Claude's multimodal capability before writing brand-dna.md
