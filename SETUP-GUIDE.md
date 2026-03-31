# Static Ad Generator v2 - Setup & Usage Guide

A fully automated pipeline for generating production-ready static ad images and Meta ad copy using Claude Code + Google Gemini AI. One command produces 50 ad creatives for any brand, complete with ad copy and a ready-to-upload CSV for Ads Uploader.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [The 4-Phase Pipeline](#the-4-phase-pipeline)
5. [Phase 1: Brand Research](#phase-1-brand-research)
6. [Phase 2: Prompt Generation](#phase-2-prompt-generation)
7. [Phase 3: Image Generation](#phase-3-image-generation)
8. [Phase 4: Ad Copy & Upload](#phase-4-ad-copy--upload)
9. [Command Reference](#command-reference)
10. [Folder Structure](#folder-structure)
11. [Troubleshooting](#troubleshooting)
12. [Cost Estimates](#cost-estimates)

---

## What This Does

This project takes a **brand name + website URL** and automatically:

1. Researches the brand (scrapes website, downloads images, takes screenshots, builds a Brand DNA document)
2. Generates 50 unique ad prompts from a template library, customized with the brand's colors, voice, product details, and pricing
3. Fires those prompts to Google Gemini's image generation API, producing images in both **1:1** (feed) and **9:16** (Stories/Reels) aspect ratios
4. Builds an interactive HTML gallery so you can pick the best image for each ad
5. Writes Meta-compliant ad copy for 3 funnel stages (TOF/MOF/BOF) using the Hook Bank framework library
6. Exports everything as an Ads Uploader-compatible CSV + Excel file, ready to upload and publish

**End result:** ~150 ad variations (50 templates x 3 funnel stages), each with paired images, copy, and targeting — ready to go live on Meta as paused ads.

---

## Prerequisites

### Software

| Requirement | Details |
|---|---|
| **Claude Code** | Anthropic's CLI tool — this is the AI that orchestrates the entire pipeline. Install from [claude.ai/code](https://claude.ai/code) |
| **Node.js 18+** | Required for the image generation and gallery scripts. Download from [nodejs.org](https://nodejs.org) |
| **VS Code** (recommended) | Claude Code runs inside VS Code as an extension. You can also use the standalone CLI |

### API Keys

You need **one** API key (the primary image generator):

| Service | What It Does | How to Get It |
|---|---|---|
| **Google Gemini API** (required) | Generates ad images from text prompts | [aistudio.google.com](https://aistudio.google.com) — create a project, enable the Generative Language API, create an API key |
| **FAL.ai API** (optional backup) | Backup image generator if Gemini is down | [fal.ai](https://fal.ai) — sign up, add credits, get API key from dashboard |

### Claude Code Skills/MCP Servers

The project uses two **Firecrawl** tools for brand research (website scraping and screenshots). Firecrawl should be available as an MCP server or skill in your Claude Code setup. If you don't have Firecrawl configured, Claude Code can still do brand research using web search — it just won't get full-page screenshots automatically.

---

## Initial Setup

### Step 1: Clone or Copy the Project

Copy this entire project folder to your machine. The folder structure should look like:

```
Static Ads v2/
├── .claude/
│   ├── skills/
│   │   ├── static-ads/SKILL.md          # Image generation skill
│   │   └── ad-copy-builder/             # Ad copy skill + references
│   └── commands/
│       ├── static-ads.md                # Slash command for /static-ads
│       └── ad-copy-builder.md           # Slash command for /ad-copy-builder
├── skills/references/
│   ├── generate_ads_gemini.mjs          # Primary image generation script
│   ├── generate_ads.mjs                 # Backup (FAL.ai) generation script
│   ├── gallery-selector.mjs             # Gallery HTML builder
│   └── ad-library.mjs                   # Ad Library preview builder
├── brands/                              # Your brand workspaces go here
├── hook-bank.md                         # 100 hook frameworks for ad copy
├── CLAUDE.md                            # Project instructions for Claude
├── package.json
└── .env.example                         # Rename to .env and add your API keys
```

### Step 2: Install the One Dependency

Open a terminal in the project folder and run:

```bash
npm install
```

This installs the `xlsx` package (used to generate Excel files for Ads Uploader). Everything else uses Node.js built-in modules — no other packages needed.

### Step 3: Add Your API Keys

Rename `.env.example` to `.env` and replace the placeholder values with your real API keys:

```
# Google Gemini API Key (required - primary image generator)
GEMINI_KEY=your-gemini-api-key-here

# FAL.ai API Key (optional - backup image generator)
FAL_KEY=your-fal-api-key-here
```

### Step 4: Open the Project in Claude Code

Open the project folder in VS Code with the Claude Code extension, or navigate to it in the Claude Code CLI:

```bash
cd "path/to/Static Ads v2"
claude
```

Claude Code will automatically read the `CLAUDE.md` file and understand the entire pipeline.

---

## The 4-Phase Pipeline

Here's the big picture of how a brand goes from URL to live ads:

```
Brand Name + URL
      │
      ▼
┌─────────────────────────┐
│  Phase 1: Brand Research │  Claude scrapes the site, downloads images,
│  (Brand DNA)             │  takes screenshots, writes brand-dna.md
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Phase 2: Prompts        │  Claude fills 50 templates with brand details
│  (prompts.json)          │  → prompts.json
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Phase 3: Image Gen      │  Node script sends prompts to Gemini API
│  (outputs/ + gallery)    │  → downloads images → builds gallery.html
└────────────┬────────────┘
             │
      You pick the best images in the gallery
             │
             ▼
┌─────────────────────────┐
│  Phase 4: Ad Copy        │  Claude writes TOF/MOF/BOF copy for each ad
│  (CSV + Excel + preview) │  → upload.csv + upload-2.xlsx + ad-library.html
└────────────┬────────────┘
             │
             ▼
      Upload to Ads Uploader → Publish as Paused on Meta
```

---

## Phase 1: Brand Research

### How to Start

In Claude Code, use the slash command:

```
/static-ads YourBrand https://yourbrand.com "Product Name"
```

Or just tell Claude what you want:

```
Create static ads for YourBrand at https://yourbrand.com. The product is [description].
```

### What Claude Will Do

1. **Create the brand folder** — `brands/yourbrand/` with `product-images/` and `brand-images/` subfolders
2. **Ask you about pricing** — Claude needs to know:
   - What price to advertise and how it's billed (monthly, annual, etc.)
   - Whether it needs a qualifier ("starting at", "as low as")
   - Any compliance/legal requirements for advertising
3. **Scrape the website** — Downloads brand images, logos, and product photos
4. **Take screenshots** — Full-page screenshots of the homepage and key pages
5. **Visually inspect screenshots** — Claude looks at the actual rendered website to extract accurate brand colors (this prevents color mistakes that happen with text-only scraping)
6. **Research the brand** — Searches for brand guidelines, press coverage, competitor positioning
7. **Write `brand-dna.md`** — A comprehensive brand identity document with colors, fonts, voice, product details, pricing rules, and a prompt modifier paragraph

### What You Need to Do

**Before Phase 2, drop your product images into the brand folder:**

```
brands/yourbrand/product-images/
├── product-front.png
├── product-angle.png
├── product-lifestyle.jpg
└── ... (any product photos you want in the ads)
```

These images are sent to the AI as visual references so it can accurately reproduce your product in the generated ads.

Claude will ask you to confirm which images to use and whether all images go with every prompt or specific images go with specific templates.

### Review the Brand DNA

After Phase 1 completes, **open `brands/yourbrand/brand-dna.md` and review it.** Check:

- Are the brand colors correct? (hex codes should match your actual brand)
- Is the pricing structure right?
- Does the voice/tone match your brand?
- Are the product details accurate?

Edit anything that's wrong before proceeding — this document feeds into every prompt.

---

## Phase 2: Prompt Generation

### What Happens

Claude reads the Brand DNA and fills out **50 ad prompt templates** with your brand's specific details. Each template is a different ad style:

| # | Template | Description |
|---|---|---|
| 01 | Headline | Bold headline with key benefit |
| 02 | Offer/Promotion | Price-forward promotional ad |
| 03 | Testimonial/Review | Customer quote or review card |
| 04 | Features & Benefits | Product feature callout grid |
| 05 | Problem/Solution | Pain point → solution framing |
| 06 | Lifestyle | Aspirational scene with product |
| 07 | Us vs. Them | Side-by-side comparison |
| 08 | Social Proof | Stats, reviews, trust signals |
| 09 | Negative Marketing | "Don't buy this if..." |
| ... | ... | (50 templates total) |

### Output

Prompts are saved to `brands/yourbrand/prompts.json` — a JSON file containing all 50 prompts, each with:
- Template number and name
- The full prompt text (with brand colors, product details, pricing baked in)
- Reference image assignments (which product photos to include)

You can review this file and edit any prompts before running image generation.

---

## Phase 3: Image Generation

### Running the Script

Once prompts.json is ready, run the image generation script:

```bash
# Full run — all 50 templates, 4 images each, both aspect ratios
# Generates ~400 images (50 templates × 4 images × 2 ratios)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/yourbrand

# Test run — just 3 templates, 1 image each, one ratio (cheap/fast)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/yourbrand --templates 1,7,13 --num-images 1 --ratios 1x1

# Specific templates only
node skills/references/generate_ads_gemini.mjs --brand-dir brands/yourbrand --templates 1,4,7,9,13 --num-images 4

# Increase parallelism for faster generation (default is 2, recommended max is 5)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/yourbrand --max-concurrent 5
```

### Script Options

| Flag | Default | Description |
|---|---|---|
| `--brand-dir` | (required) | Path to the brand folder |
| `--templates` | all | Comma-separated template numbers to generate (e.g., `1,7,13`) |
| `--num-images` | 4 | Number of image variations per prompt per ratio |
| `--ratios` | `1x1,9x16` | Which aspect ratios to generate (`1x1`, `9x16`, or both) |
| `--max-concurrent` | 2 | Number of parallel API requests (max recommended: 5) |

### What the Script Does

1. Reads `prompts.json` and product images from `product-images/`
2. Sends each prompt to Google Gemini with product images as base64 reference
3. Downloads generated images into organized folders
4. Automatically appends safe zone instructions to 9:16 images (keeps top 15% and bottom 25% clear of text/logos for Meta Stories/Reels UI overlays)
5. Builds `gallery.html` — an interactive gallery for reviewing and selecting images

### Output Structure

```
brands/yourbrand/outputs/{date}-V{n}/
├── 01-headline/
│   ├── prompt.txt
│   ├── 1x1/
│   │   ├── headline_1x1_v1.png
│   │   ├── headline_1x1_v2.png
│   │   ├── headline_1x1_v3.png
│   │   └── headline_1x1_v4.png
│   └── 9x16/
│       ├── headline_9x16_v1.png
│       ├── headline_9x16_v2.png
│       ├── headline_9x16_v3.png
│       └── headline_9x16_v4.png
├── 02-offer-promotion/
│   └── ...
├── ... (50 template folders)
└── gallery.html
```

### Selecting Your Best Images

1. **Open `gallery.html`** in your browser (the script opens it automatically, or double-click it)
2. You'll see all generated images in a dark-theme gallery, grouped by template
3. **Click the radio button** under the best image for each template and ratio
4. Click **"Save Selections"** at the top of the page
5. This writes `selections.json` into the output folder — Phase 4 reads this file

If you need to rebuild the gallery later (e.g., it's missing or empty):

```bash
node skills/references/gallery-selector.mjs --output-dir brands/yourbrand/outputs/{version} --open
```

---

## Phase 4: Ad Copy & Upload

### Starting the Copy Builder

After selecting your images in the gallery and saving `selections.json`, tell Claude:

```
create copy for yourbrand {version-folder-name}
```

For example:
```
create copy for yourbrand 3-30-26-V1
```

Or use the slash command:
```
/ad-copy-builder yourbrand {version}
```

### What Claude Does

1. **Reads your selections** — loads `selections.json`, `brand-dna.md`, and `hook-bank.md`
2. **Matches hooks to templates** — For each selected template, picks 3 hook frameworks (one per funnel stage) from the 100-hook library
3. **Writes 3 variants per template:**

| Funnel Stage | Audience | Copy Style |
|---|---|---|
| **TOF (Cold)** | Never heard of you | Curiosity-driven, no hard sell, no price upfront |
| **MOF (Warm)** | Visited your site, engaged with content | Differentiation, social proof, "why us" |
| **BOF (Retargeting)** | Abandoned checkout, started signup | Direct offer, price, guarantee, hard CTA |

4. **Builds the CSV** — Each template produces 3 rows (TOF + MOF + BOF), with all fields mapped to Ads Uploader's format
5. **Creates `Ad-uploads/` folder** — Copies selected images with clean filenames (strips version suffixes so 1x1 and 9x16 variants pair correctly)
6. **Generates `upload-2.xlsx`** — Excel version of the CSV for Ads Uploader
7. **Generates `ad-library.html`** — A Facebook Ad Library-style preview so you can see how every ad will look before publishing

### Output Files

```
brands/yourbrand/outputs/{version}/
├── upload.csv              # Ads Uploader CSV
├── upload-3.csv            # Funnel-format CSV (same data)
├── upload-2.xlsx           # Excel version for Ads Uploader
├── copy-summary.md         # Human-readable copy for review
├── ad-library.html         # Visual preview of all ads
├── selections.json         # Your image selections
└── Ad-uploads/             # Flat folder of selected images
    ├── headline_1x1.jpg
    ├── headline_9x16.jpg
    ├── offer-promotion_1x1.jpg
    ├── offer-promotion_9x16.jpg
    └── ... (all selected images, clean filenames)
```

### Uploading to Meta via Ads Uploader

1. Open [Ads Uploader](https://adsuploader.com)
2. Upload `upload-2.xlsx` as the data file
3. Point to the `Ad-uploads/` folder as your media root
4. Map the CSV columns to Meta fields (first time only — Ads Uploader remembers the mapping)
5. For Stories/Reels placements: attach the 9x16 image manually under placement-specific media
6. **Publish as PAUSED** — always review all ads before setting them live

---

## Command Reference

### Quick Reference (Copy-Paste)

```bash
# === PHASE 1-2: Brand Research + Prompts (run in Claude Code) ===
/static-ads mybrand https://mybrand.com "Product Name"

# === PHASE 3: Image Generation ===

# Full run (all 50 templates)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand

# Test run (3 templates, fast & cheap)
node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand --templates 1,7,13 --num-images 1 --ratios 1x1

# Rebuild gallery if needed
node skills/references/gallery-selector.mjs --output-dir brands/mybrand/outputs/{version} --open

# === PHASE 4: Ad Copy (run in Claude Code) ===
# "create copy for mybrand {version}"

# === UTILITIES ===

# Rebuild gallery for existing output folder
node skills/references/gallery-selector.mjs --output-dir brands/mybrand/outputs/{version} --open

# Generate ad library preview
node skills/references/ad-library.mjs --output-dir brands/mybrand/outputs/{version} --open
```

### Backup: FAL.ai Image Generation

If Google Gemini is down or unavailable, use the backup FAL.ai script:

```bash
# Full run (~$48 for 50 templates at default settings)
node skills/references/generate_ads.mjs --brand-dir brands/mybrand

# Test run
node skills/references/generate_ads.mjs --brand-dir brands/mybrand --templates 1,7,13 --num-images 1 --resolution 1K
```

FAL.ai options include `--resolution` (0.5K, 1K, 2K, 4K) instead of relying on prompt-based aspect ratio control.

---

## Folder Structure

### Project Root

```
Static Ads v2/
├── .claude/                    # Claude Code configuration
│   ├── skills/                 # Skill definitions (the AI's instructions)
│   │   ├── static-ads/         # Phase 1-3 skill
│   │   └── ad-copy-builder/    # Phase 4 skill + compliance rules
│   └── commands/               # Slash commands (linked to skills)
├── skills/references/          # Node.js scripts
├── brands/                     # All brand workspaces
│   ├── mybrand/
│   ├── anotherbrand/
│   └── ...
├── hook-bank.md                # 100 hook frameworks for ad copywriting
├── CLAUDE.md                   # Project instructions for Claude
├── package.json                # Node dependencies (just xlsx)
└── .env.example                # Rename to .env and add your API keys
```

### Per-Brand Workspace

```
brands/mybrand/
├── product-images/             # YOUR product photos (drop these in manually)
│   ├── product-front.png
│   └── product-angle.png
├── brand-images/               # Auto-downloaded from website during Phase 1
│   ├── homepage-screenshot.png
│   ├── logo.png
│   └── image-index.md
├── brand-dna.md                # Brand identity document (generated Phase 1)
├── prompts.json                # 50 ad prompts (generated Phase 2)
└── outputs/
    └── 3-30-26-V1/             # One folder per generation run
        ├── 01-headline/
        │   ├── 1x1/            # Square images (feed, desktop)
        │   └── 9x16/           # Vertical images (Stories, Reels)
        ├── ...
        ├── gallery.html        # Image selection UI
        ├── selections.json     # Your picks
        ├── upload.csv           # Ads Uploader CSV
        ├── upload-2.xlsx        # Excel version
        ├── copy-summary.md      # Human-readable copy
        ├── ad-library.html      # Ad Library preview
        └── Ad-uploads/          # Clean image files for upload
```

---

## Troubleshooting

### "GEMINI_KEY not found"

Make sure your `.env` file is in the project root (same folder as `package.json`) and contains:
```
GEMINI_KEY=your-key-here
```

### Gallery is empty or missing

Rebuild it:
```bash
node skills/references/gallery-selector.mjs --output-dir brands/mybrand/outputs/{version} --open
```

### Images look wrong / wrong brand colors

1. Check `brand-dna.md` — are the hex codes correct?
2. Edit the Brand DNA and re-run Phase 2 (prompt generation) to update `prompts.json`
3. Re-run Phase 3 for the affected templates:
   ```bash
   node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand --templates 1,7,13
   ```

### Rate limiting / API errors

- Reduce parallelism: `--max-concurrent 2` (or even 1)
- The script automatically retries failed requests up to 3 times with 10-second delays
- If Gemini is persistently failing, switch to the FAL.ai backup script

### "xlsx" module not found

Run `npm install` in the project root.

### Python errors

This project does NOT use Python. All scripts are Node.js. If you see Python errors, you're running the wrong file. Use the `.mjs` scripts, not any `.py` files.

---

## Cost Estimates

### Google Gemini (Primary)

Gemini pricing is per-request. A full 50-template run with 4 images each and both aspect ratios = ~400 API calls. Check current Gemini pricing at [ai.google.dev/pricing](https://ai.google.dev/pricing).

**Cheap test run** (3 templates, 1 image, 1 ratio = 3 API calls):
```bash
node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand --templates 1,7,13 --num-images 1 --ratios 1x1
```

### FAL.ai (Backup)

| Resolution | Per Image | Full Run (50 templates, 4 imgs, 2 ratios = 400 imgs) |
|---|---|---|
| 1K | ~$0.08 | ~$32 |
| 2K | ~$0.12 | ~$48 |
| 4K | ~$0.16 | ~$64 |

---

## Tips for Best Results

1. **Product images matter** — Higher quality product photos = better generated ads. Use clean PNGs with transparent or white backgrounds when possible.

2. **Review the Brand DNA** — Spend 2 minutes checking the colors and pricing before generating 400 images. Fixing one hex code is cheaper than re-running everything.

3. **Start with a test run** — Always run 3 templates first to check quality before committing to the full 50:
   ```bash
   node skills/references/generate_ads_gemini.mjs --brand-dir brands/mybrand --templates 1,7,13 --num-images 2 --ratios 1x1
   ```

4. **Use the gallery** — The selection step is where you control quality. Pick only the best images for each template. You can exclude weak templates entirely.

5. **Publish paused** — Always upload to Meta as paused ads first. Review everything in Ads Manager before turning anything on.

6. **Iterate** — You can re-run specific templates anytime. If template 7 ("Us vs. Them") didn't turn out well, just re-run that one with `--templates 7`.
