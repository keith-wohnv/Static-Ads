---
name: ad-copy-builder
description: >
  Generate production-ready Meta ad copy for a brand's image batch, then output
  an Ads Uploader-compatible CSV ready to upload to Facebook/Instagram.

  TRIGGER when the user says anything like:
  - "create copy for [brand] [output folder]"
  - "generate ad copy for {brand} {version}"
  - "build the CSV for [brand]"
  - "write copy for [output folder]"
  - "prepare ads uploader file for [brand]"

  Works with the 3-phase pipeline: gallery selection → copy generation → CSV export.
---

# Ad Copy Builder

Turns a completed image batch into a production-ready Ads Uploader CSV with
compliant Meta ad copy drawn from the Hook Bank framework library.

## What You Need Before Starting

1. **A completed image batch** — e.g. `brands/{brand}/outputs/{version}/`
2. **selections.json** in that folder — from the gallery selector (see below)
3. **brand-dna.md** — at `brands/{brand}/brand-dna.md`

If `selections.json` is missing, stop and run:
```bash
node skills/references/gallery-selector.mjs --output-dir brands/{brand}/outputs/{version} --open
```
Then: open gallery.html → pick best image per group → Save Selections → copy `selections.json` into the output folder.

---

## Phase 1 — Load Context

Read these files in parallel:
- `brands/{brand}/brand-dna.md` — brand voice, pricing rules, visual identity, key stats
- `brands/{brand}/outputs/{version}/selections.json` — which images were chosen
- `hook-bank.md` — hook framework library (in project root)

From `selections.json`, build the working list: one entry per template — `{ template, images: { '1x1': path, '9x16': path } }`. The two ratios are the same ad served on different placements (feed vs. Stories/Reels), so they share one set of copy.

---

## Phase 2 — Match Hooks to Templates

For each template in the selections, pick hook frameworks from `hook-bank.md` — one per funnel stage (TOF, MOF, BOF).

Read `references/template-hook-map.md` for the template → hook type → specific hook recommendations.

**How to pick the right hook per stage:**

1. Look up the template name in `template-hook-map.md` to get the recommended hook types
2. Map those hook types to funnel stages using this guide:

| Funnel Stage | Audience | Preferred Hook Types |
|---|---|---|
| **TOF (Cold)** | Never heard of the brand | Curiosity gap, Identity call-out, Pain/Empathy, Contrarian, Narrative |
| **MOF (Warm)** | Visited site, watched video, engaged | Social proof, Comparison, Feature callout, Objection removal |
| **BOF (Retargeting)** | Abandoned checkout / started signup | Direct offer, Urgency, Risk reversal, Guarantee |

3. For each template, select one hook per stage — three hooks total per template
4. Each hook template text becomes the structural backbone of that stage's Primary Text

---

## Phase 3 — Write Ad Copy (3 Variants Per Template)

For each template, write **three complete sets of copy** — one per funnel stage. Ratios (1x1, 9x16) share the same copy within each stage.

| Field | Spec | Notes |
|-------|------|-------|
| Primary Text | 125 chars visible (2,200 max) | Front-load the hook |
| Headline | 40 chars max | Below the image; benefit-driven |
| Description | 30 chars max | Below headline; reinforce CTA |
| Call to Action | Fixed enum | See csv-format.md for options |

**TOF copy rules (Cold audience — problem-aware or unaware):**
- Open with a curiosity gap, identity call-out, or pain hook — never with the offer
- Don't name the brand in the first 1-2 lines
- 3-5 sentences; conversational, not corporate
- End with a soft CTA ("See how it works" / "Link in bio")
- No hard sell, no price in the opening

**MOF copy rules (Warm audience — solution-aware):**
- Open with differentiation or social proof — they know the category exists, address "why you vs. alternatives"
- Can name the brand; reference what makes it different
- Address the hesitation objection that stopped them from buying ("Works even if you've tried X before")
- Medium length; confident, direct

**BOF copy rules (Retargeting — product-aware):**
- Shortest copy — they already know you, don't re-introduce
- Lead immediately with the offer, guarantee, or price
- Remove the last remaining friction ("Starting at $X/mo. Cancel anytime.")
- Hard CTA ("Get started today" / "Claim your spot")
- 1-3 sentences max for primary text

**Universal writing rules (all stages):**
- Headline: Compress the core benefit into ≤40 chars — different angle from the primary text opening
- Description: Reinforce the offer or handle a micro-objection
- Vary hook angles across templates — don't use the same hook type for multiple ads within the same stage
- Include the brand's strongest proof point somewhere in at least one field per ad

**Read `references/compliance.md` before writing — it contains brand-specific ad copy rules.**

Key rules at a glance (customize in compliance.md):
- Follow all brand-specific pricing and disclaimer requirements
- No outcome guarantees or exaggerated claims
- Ensure ad copy matches landing page in tone and claims
- Include any required industry disclaimers

---

## Phase 4 — Assemble CSV

Read `references/csv-format.md` for the exact Ads Uploader column spec.

**CSV text rules:**
- **Quote EVERY field** — wrap all fields in double quotes, not just Primary Text. Numbers like "10,000" contain commas that break CSV parsers when fields are unquoted. No exceptions.
- Internal double quotes within a field must be escaped as `""` (e.g., `"She said ""hello"""`)
- Never use em dashes (—) anywhere in ad copy, campaign names, or ad set names — they break CSV importers. Use a plain hyphen (-) instead.
- All ad copy fields must be plain ASCII + standard punctuation only.

**Image file columns — two columns, one row per ad:**
- `Image File Name (1x1)` — flat filename of the square image (feed, desktop). Use this as the primary upload image.
- `Image File Name (9x16)` — flat filename of the vertical image (Stories, Reels, mobile). Included for reference; attach manually in Ads Uploader under placement-specific media if needed.

Filenames are flat basenames matching the files in the `Ad-uploads/` folder — no subfolder paths. Point Ads Uploader at `Ad-uploads/` as the media root.

**CRITICAL — Strip `_v#` from all image filenames.** The version suffix (`_v1`, `_v2`, etc.) from image generation MUST be removed so the 1x1 and 9x16 variants of the same template share the same base name. If left in, Meta/Ads Uploader won't pair them as placement variants for the same ad because the names differ (e.g., `_v2` vs `_v3`).

Example (correct):
- `headline_1x1.jpg`
- `headline_9x16.jpg`

Example (WRONG — will break Ads Uploader pairing):
- `headline_1x1_v2.jpg`
- `headline_9x16_v3.jpg`

**Each template produces 3 rows — one per funnel stage:**

| Stage | Ad Set Name | Ad Name Suffix |
|---|---|---|
| TOF | `Cold - [Age Range]` | `_TOF` |
| MOF | `Warm - [Age Range]` | `_MOF` |
| BOF | `Retargeting - [Age Range]` | `_BOF` |

**Ad naming convention:**
```
{BRAND_ABBR}_{TEMPLATE_NUM}-{TEMPLATE_SLUG}_{HOOK_TYPE}_{STAGE}_V{BATCH}
```
Examples:
- `MTX_01-headline_CURIOSITY_TOF_V10`
- `MTX_01-headline_SOCIAL-PROOF_MOF_V10`
- `MTX_01-headline_OFFER_BOF_V10`

**Campaign and Ad Set naming:**
- Ask the user if they have a campaign + ad set structure already set up, or use the brand defaults from `brand-dna.md`
- Default Campaign: `{Brand} - {Month} {Year}`
- Default Ad Sets (three, one per stage):
  - `Cold - [Age Range]` (e.g., `Cold - 35-55`)
  - `Warm - [Age Range]` (e.g., `Warm - 35-55`)
  - `Retargeting - [Age Range]` (e.g., `Retargeting - 35-55`)

For a 40-template batch, the CSV will have ~120 rows (40 templates × 3 stages). The same image paths repeat across the 3 rows for each template — only the copy and ad set differ.

---

## Phase 5 — Output

Save the CSV to: `brands/{brand}/outputs/{version}/upload.csv`

Also save a human-readable summary to: `brands/{brand}/outputs/{version}/copy-summary.md`

The summary should list each template with all three funnel stage variants:

```
## Template 01 — Headline
Images: 01-headline/1x1/... | 01-headline/9x16/...

### TOF (Cold)
Hook: [hook framework name]
Primary Text: [full text]
Headline: [text] | Description: [text] | CTA: [CTA]

### MOF (Warm)
Hook: [hook framework name]
Primary Text: [full text]
Headline: [text] | Description: [text] | CTA: [CTA]

### BOF (Retargeting)
Hook: [hook framework name]
Primary Text: [full text]
Headline: [text] | Description: [text] | CTA: [CTA]
```

**After saving upload.csv, run the Ad-uploads build step (inline — do NOT use rebuild-upload-csv.mjs, it expects the old dual-row format):**

1. **Create `Ad-uploads/` folder** — copy all selected images from selections.json into `brands/{brand}/outputs/{version}/Ad-uploads/` as flat filenames with `_v#` stripped:
```js
// For each entry in selections.json (skip "excluded"):
//   Copy 01-headline/1x1/headline_1x1_v2.jpg → Ad-uploads/headline_1x1.jpg
//   Copy 01-headline/9x16/headline_9x16_v3.jpg → Ad-uploads/headline_9x16.jpg
// Strip _v# with: filename.replace(/_v\d+(?=\.\w+$)/, '')
```

2. **Save `upload-3.csv`** — copy of upload.csv (ad-library.mjs reads upload-3.csv as "funnel" format with both image columns; upload.csv is treated as legacy "dual" format).

3. **Generate `upload-2.xlsx`** — convert upload-3.csv to Excel using the xlsx package:
```js
const XLSX = require('xlsx');
// Parse CSV → array of arrays → XLSX.utils.aoa_to_sheet → writeFile
```

4. **Generate the Ad Library preview:**
```bash
node skills/references/ad-library.mjs --output-dir brands/{brand}/outputs/{version} --open
```
This builds `ad-library.html` — a Facebook Ad Library-style preview gallery with filtering by funnel stage, hook type, template, and aspect ratio (Feed 1:1 / Stories 9:16). The `--open` flag launches it in the browser automatically.

After saving, tell the user:
```
✓ upload.csv ready — {N} ads
✓ upload-2.xlsx ready — {N} ads (two image columns per row)
✓ Ad-uploads/ created — {N} images copied
✓ copy-summary.md saved
✓ ad-library.html generated — Ad Library preview opened in browser

Next steps:
1. Open Ads Uploader
2. Upload: upload-2.xlsx + the Ad-uploads/ folder as your media root
3. For Stories/Reels: attach 9x16 image manually under placement-specific media
4. Map fields (first time only)
5. Publish as PAUSED — review before going live
```

---

## Reference Files

- `references/template-hook-map.md` — template slug → recommended hook types + specific hooks
- `references/compliance.md` — telehealth advertising rules for all brands
- `references/csv-format.md` — Ads Uploader column spec + CTA options + example row
