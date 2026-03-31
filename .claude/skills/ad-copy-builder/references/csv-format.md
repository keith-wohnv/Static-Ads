# Ads Uploader CSV Format

Reference: https://adsuploader.com/docs/quick-start/overview

Ads Uploader maps CSV columns to Meta ad fields. The upload flow is:
1. Upload CSV + media folder → Ads Uploader maps fields (first time) → validate → publish as PAUSED

---

## Required Columns (Meta / Facebook + Instagram)

| Column | Meta Field | Limit | Notes |
|--------|-----------|-------|-------|
| `Campaign Name` | Campaign | — | Group all ads from one batch under one campaign |
| `Ad Set Name` | Ad Set | — | Audience targeting level |
| `Ad Name` | Ad | — | Unique identifier for this creative |
| `Primary Text` | Ad body copy | 2,200 chars (125 visible) | Front-load the hook in the first 125 chars |
| `Headline` | Ad headline | 40 chars recommended | Shown below the image |
| `Description` | Ad description | 30 chars recommended | Below headline (not all placements) |
| `Call to Action` | CTA button | See enum below | Must match exact Ads Uploader value |
| `Website URL` | Destination URL | — | Final landing page (with UTM params if used) |
| `Image File Name (1x1)` | Media (primary) | — | Flat filename of the square image from `Ad-uploads/`. Strip `_v#` suffix so 1x1/9x16 pair correctly. |
| `Image File Name (9x16)` | Media (vertical) | — | Flat filename of the vertical image from `Ad-uploads/`. Strip `_v#` suffix. Attach manually under placement-specific media. |

## Tracking Columns (Internal — Ads Uploader passes through, Meta ignores)

| Column | Purpose |
|--------|---------|
| `Hook Type` | Track which hook framework was used (e.g., CURIOSITY, PROOF, PAIN) |
| `Template` | Template slug (e.g., `01-headline`, `07-us-vs-them`) |
| `Batch ID` | Output folder version (e.g., `3-16-26-V10`) |
| `UTM Content` | Auto-populate with Ad Name for analytics tracking |

---

## Call to Action Values (exact strings for Ads Uploader)

Use one of these exact values in the `Call to Action` column:

| Value | When to use |
|-------|------------|
| `LEARN_MORE` | Default for most awareness/TOF ads |
| `SHOP_NOW` | Product-focused offer ads |
| `SIGN_UP` | Lead gen / consultation booking |
| `GET_QUOTE` | Quote/consultation request |
| `BOOK_NOW` | Appointment booking (telehealth) |
| `CONTACT_US` | Soft CTA for trust-building ads |
| `GET_STARTED` | Onboarding / trial start |
| `APPLY_NOW` | Application/intake forms |

**Suggested defaults:** `LEARN_MORE` (awareness/TOF) or `SHOP_NOW` / `GET_STARTED` (retargeting/BOF)

---

## Ad Naming Convention

One ad per template — no ratio in the name (both image formats are attached to the same ad).

```
{BRAND}_{TEMPLATE}_{HOOK_TYPE}_V{BATCH}
```

Examples:
- `ACME_01-headline_CURIOSITY_V1`
- `ACME_07-us-vs-them_CONTRAST_V1`
- `ACME_03-testimonial_PROOF_V3`

Brand abbreviations: use a short 2-4 letter code for your brand (e.g., `ACME` for Acme Co).

---

## Campaign / Ad Set Naming

**Campaign:**
```
{Brand} — {Month} {Year} — {Objective}
```
Example: `Acme Co — March 2026 — Conversions`

**Ad Set:**
```
{Audience} — {Age} — {Temp/Stage}
```
Examples:
- `Women 25-45 — Cold — TOF`
- `Women 25-45 — WCA — BOF`
- `Women 25-45 — Retarget 30d — BOF`

---

## Website URL + UTM Template

```
https://yourbrand.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign={{Campaign Name}}&utm_content={{Ad Name}}
```

For Ads Uploader, set the base URL and append UTM params per ad in the `Website URL` column.

---

## Example CSV Row

```csv
Campaign Name,Ad Set Name,Ad Name,Primary Text,Headline,Description,Call to Action,Website URL,Image File Name (1x1),Image File Name (9x16),Hook Type,Template,Batch ID
Acme Co - March 2026 - Conversions,Women 25-45 - Cold - TOF,ACME_01-headline_CURIOSITY_V1,"Most people don't realize how much better their mornings could be. Acme Co makes it simple - premium ingredients, zero hassle, delivered to your door. Starting at $29/mo.","Mornings, Upgraded","Starting at $29/mo. Free shipping.",LEARN_MORE,https://yourbrand.com/?utm_source=facebook&utm_medium=paid&utm_campaign=march-2026&utm_content=ACME_01-headline_CURIOSITY_V1,headline_1x1.png,headline_9x16.png,CURIOSITY,01-headline,3-30-26-V1
```

---

## File Delivery

- **CSV filename**: `upload.csv` in the output folder
- **Media folder**: Point Ads Uploader at `Ad-uploads/` inside the output folder as the media root
- The `Image File Name` columns contain flat filenames (no subfolders) matching the files in `Ad-uploads/`
- Publish as **PAUSED** first — review all ads before going live

---

## Quick Validation Checklist

Before uploading:
- [ ] Primary Text ≤ 2,200 chars per cell; hook appears in first 125 chars
- [ ] Headline ≤ 40 chars
- [ ] Description ≤ 30 chars
- [ ] No blank required fields
- [ ] Image paths match actual files in the output folder
- [ ] CTA values match exact enum strings above
- [ ] All brand compliance rules satisfied (see compliance.md)
