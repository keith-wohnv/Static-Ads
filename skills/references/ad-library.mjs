#!/usr/bin/env node
/**
 * ad-library.mjs — Local Facebook Ad Library preview generator
 *
 * Reads upload-3.csv (or upload-2.csv / upload.csv) + selections.json from an
 * ad output folder and generates ad-library.html — a Facebook-style ad preview
 * gallery with filtering by funnel stage, hook type, template, and aspect ratio.
 *
 * Usage:
 *   node skills/references/ad-library.mjs --output-dir brands/{name}/outputs/{version}
 *   node skills/references/ad-library.mjs --output-dir brands/{name}/outputs/{version} --open
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";
import XLSX from "xlsx";
import { parseArgs } from "util";
import { exec } from "child_process";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "output-dir": { type: "string" },
    open: { type: "boolean", default: false },
  },
});

const outputDir = args["output-dir"];
if (!outputDir) {
  console.error(
    "Usage: node ad-library.mjs --output-dir <path> [--open]"
  );
  process.exit(1);
}

if (!existsSync(outputDir)) {
  console.error(`Output dir not found: ${outputDir}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields with commas/newlines)
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row = [];
    while (i < len) {
      let field = "";
      if (text[i] === '"') {
        i++; // skip opening quote
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
      } else {
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i];
          i++;
        }
      }
      row.push(field);
      if (i < len && text[i] === ",") {
        i++;
      } else {
        break;
      }
    }
    // skip line endings
    while (i < len && (text[i] === "\r" || text[i] === "\n")) i++;
    if (row.length > 1 || (row.length === 1 && row[0].trim())) {
      rows.push(row);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Detect CSV format and load data
// ---------------------------------------------------------------------------

let csvPath, csvType;
for (const [file, type] of [
  ["upload-3.xlsx", "funnel"],
  ["upload-2.xlsx", "merged"],
  ["upload-3.csv", "funnel"],
  ["upload-2.csv", "merged"],
  ["upload.csv", "dual"],
]) {
  const p = join(outputDir, file);
  if (existsSync(p)) {
    csvPath = p;
    csvType = type;
    break;
  }
}

if (!csvPath) {
  console.error("No upload file (xlsx/csv) found in output dir.");
  process.exit(1);
}

console.log(`Reading ${basename(csvPath)} (${csvType} format)...`);

let rawAds;
if (csvPath.endsWith(".xlsx")) {
  const wb = XLSX.readFile(csvPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  rawAds = rows.map((row) => {
    const obj = {};
    for (const [k, v] of Object.entries(row)) obj[k.trim()] = String(v).trim();
    return obj;
  });
} else {
  const csvText = readFileSync(csvPath, "utf-8");
  const csvRows = parseCSV(csvText);
  const headers = csvRows[0].map((h) => h.trim());
  const dataRows = csvRows.slice(1);
  rawAds = dataRows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (row[i] || "").trim()));
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Normalize into a consistent ad array
// ---------------------------------------------------------------------------

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toUpperCase();
  } catch {
    return "";
  }
}

function detectFunnel(adSetName, adName) {
  const lower = (adSetName + " " + adName).toLowerCase();
  if (lower.includes("retarget") || lower.includes("_bof")) return "BOF";
  if (lower.includes("warm") || lower.includes("_mof")) return "MOF";
  if (lower.includes("cold") || lower.includes("_tof")) return "TOF";
  return "TOF";
}

let ads = [];

if (csvType === "dual") {
  // upload.csv: two rows per template (1x1 + 9x16) → merge
  const grouped = {};
  for (const row of rawAds) {
    const tpl = row["Template"] || "";
    if (!grouped[tpl]) grouped[tpl] = {};
    const ratio = (row["Aspect Ratio"] || "").trim();
    grouped[tpl][ratio] = row;
  }
  for (const [tpl, ratios] of Object.entries(grouped)) {
    const base = ratios["1x1"] || ratios["9x16"] || Object.values(ratios)[0];
    ads.push({
      campaignName: base["Campaign Name"] || "",
      adSetName: base["Ad Set Name"] || "",
      adName: base["Ad Name"] || "",
      primaryText: base["Primary Text"] || "",
      headline: base["Headline"] || "",
      description: base["Description"] || "",
      cta: base["Call to Action"] || "",
      websiteUrl: base["Website URL"] || "",
      domain: extractDomain(base["Website URL"] || ""),
      image1x1: (ratios["1x1"] || {})["Image File Name"] || "",
      image9x16: (ratios["9x16"] || {})["Image File Name"] || "",
      hookType: base["Hook Type"] || "",
      template: tpl,
      batchId: base["Batch ID"] || "",
      funnel: detectFunnel(base["Ad Set Name"] || "", base["Ad Name"] || ""),
    });
  }
} else {
  // upload-2.csv or upload-3.csv: already merged with both image columns
  for (const row of rawAds) {
    ads.push({
      campaignName: row["Campaign Name"] || "",
      adSetName: row["Ad Set Name"] || "",
      adName: row["Ad Name"] || "",
      primaryText: row["Primary Text"] || "",
      headline: row["Headline"] || "",
      description: row["Description"] || "",
      cta: row["Call to Action"] || "",
      websiteUrl: row["Website URL"] || "",
      domain: extractDomain(row["Website URL"] || ""),
      image1x1: row["Image File Name (1x1)"] || "",
      image9x16: row["Image File Name (9x16)"] || "",
      hookType: row["Hook Type"] || "",
      template: row["Template"] || "",
      batchId: row["Batch ID"] || "",
      funnel: detectFunnel(row["Ad Set Name"] || "", row["Ad Name"] || ""),
    });
  }
}

// ---------------------------------------------------------------------------
// Brand info
// ---------------------------------------------------------------------------

const campaignName = ads[0]?.campaignName || "Ad Library";
const brandName = campaignName.split(" - ")[0].trim();
const batchId = ads[0]?.batchId || basename(outputDir);
const brandInitials = brandName
  .split(/\s+/)
  .map((w) => w[0])
  .join("")
  .slice(0, 2)
  .toUpperCase();

// Check for brand logo
const brandDir = join(outputDir, "..", "..");
const logoRelPath = "../../brand-images/logo-full.png";
const hasLogo = existsSync(join(outputDir, logoRelPath));

// Resolve image paths — CSV now stores flat filenames (e.g. headline_1x1_v1.png).
// Prepend Ad-uploads/ if that folder exists, otherwise try template subfolder paths.
const adUploadsDir = join(outputDir, "Ad-uploads");
const useAdUploads = existsSync(adUploadsDir);
for (const ad of ads) {
  if (useAdUploads) {
    // Flat filenames → Ad-uploads/filename.png
    if (ad.image1x1) ad.image1x1 = "Ad-uploads/" + basename(ad.image1x1);
    if (ad.image9x16) ad.image9x16 = "Ad-uploads/" + basename(ad.image9x16);
  }
  // else: legacy nested paths (01-headline/1x1/...) work as-is relative to output dir
}
if (useAdUploads) console.log("Using approved images from Ad-uploads/");

// Unique hook types and templates for filters
const hookTypes = [...new Set(ads.map((a) => a.hookType))].filter(Boolean).sort();
const templates = [...new Set(ads.map((a) => a.template))].filter(Boolean).sort();
const hasFunnel = csvType === "funnel" || new Set(ads.map((a) => a.funnel)).size > 1;

console.log(
  `${ads.length} ads | ${templates.length} templates | ${hookTypes.length} hook types | funnel: ${hasFunnel}`
);

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ad Library — ${brandName} ${batchId}</title>
<style>
/* ── Reset & Base ───────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
     font-size:15px;line-height:1.34;color:#050505;background:#F0F2F5;-webkit-font-smoothing:antialiased}
body{padding-top:120px;padding-bottom:40px}

/* ── Toolbar ────────────────────────────────────────────────── */
.toolbar{position:fixed;top:0;left:0;right:0;z-index:100;background:#fff;
  border-bottom:1px solid #CED0D4;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.toolbar-inner{max-width:1400px;margin:0 auto;padding:12px 24px}
.toolbar-top{display:flex;align-items:center;gap:16px;margin-bottom:10px}
.toolbar-brand{display:flex;align-items:center;gap:10px;flex-shrink:0}
.brand-logo-sm{width:32px;height:32px;border-radius:8px;object-fit:contain;background:#f0f0f0}
.brand-initials-sm{width:32px;height:32px;border-radius:8px;background:#1877F2;color:#fff;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.toolbar-title{font-size:18px;font-weight:700;color:#050505}
.toolbar-batch{font-size:13px;color:#65676B;font-weight:400}
.toolbar-count{margin-left:auto;font-size:13px;color:#65676B;font-weight:600;
  background:#E4E6EB;padding:4px 12px;border-radius:16px;white-space:nowrap}

/* ── Filters ────────────────────────────────────────────────── */
.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.search-box{padding:7px 12px;border:1px solid #CED0D4;border-radius:20px;font-size:13px;
  width:220px;outline:none;background:#F0F2F5;transition:border .15s}
.search-box:focus{border-color:#1877F2;background:#fff}
.filter-sep{width:1px;height:24px;background:#CED0D4;flex-shrink:0}
.pill-group{display:flex;gap:2px;background:#E4E6EB;border-radius:8px;padding:2px}
.pill{padding:5px 14px;border:none;border-radius:6px;font-size:13px;font-weight:600;
  cursor:pointer;background:transparent;color:#65676B;transition:all .15s;white-space:nowrap}
.pill:hover{color:#050505}
.pill.active{background:#fff;color:#050505;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.filter-select{padding:6px 10px;border:1px solid #CED0D4;border-radius:8px;font-size:13px;
  background:#fff;color:#050505;cursor:pointer;outline:none;max-width:180px}
.filter-select:focus{border-color:#1877F2}

/* ── Grid ───────────────────────────────────────────────────── */
.grid{max-width:1400px;margin:0 auto;padding:0 24px;
  display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.grid.stories-mode{grid-template-columns:repeat(4,1fr);max-width:1600px}
@media(max-width:1280px){.grid.stories-mode{grid-template-columns:repeat(3,1fr)}}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,1fr)}.grid.stories-mode{grid-template-columns:repeat(2,1fr)}}
@media(max-width:680px){.grid{grid-template-columns:1fr}.grid.stories-mode{grid-template-columns:1fr}}

.no-results{grid-column:1/-1;text-align:center;padding:80px 20px;color:#65676B}
.no-results h3{font-size:20px;margin-bottom:8px;color:#050505}

/* ── Ad Card ────────────────────────────────────────────────── */
.ad-card{background:#fff;border-radius:10px;overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.1);transition:box-shadow .2s,transform .2s;
  display:flex;flex-direction:column}
.ad-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.15);transform:translateY(-1px)}

/* Header */
.ad-header{display:flex;align-items:center;gap:10px;padding:12px 16px}
.brand-avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;overflow:hidden;
  background:#E4E6EB;display:flex;align-items:center;justify-content:center}
.brand-avatar img{width:100%;height:100%;object-fit:cover}
.brand-avatar-initials{font-weight:700;font-size:14px;color:#1877F2}
.brand-meta{flex:1;min-width:0}
.brand-meta-name{font-weight:600;font-size:14px;color:#050505}
.brand-meta-sub{font-size:12px;color:#65676B}
.ad-header-menu{color:#65676B;font-size:20px;cursor:default;padding:4px;line-height:1}

/* Primary text */
.ad-text{padding:0 16px 12px;font-size:14px;line-height:1.4;color:#050505;position:relative}
.ad-text-full{display:none}
.ad-text.expanded .ad-text-truncated{display:none}
.ad-text.expanded .ad-text-full{display:inline}
.see-more{color:#65676B;font-weight:600;cursor:pointer;font-size:14px}
.see-more:hover{text-decoration:underline}

/* Image */
.ad-image{width:100%;position:relative;background:#E4E6EB;cursor:pointer;overflow:hidden}
.ad-image img{width:100%;display:block}
.ad-image.ratio-1x1 img{aspect-ratio:1/1;object-fit:cover}
.ad-image.ratio-9x16 img{/* natural aspect ratio — no crop, no max-height */}
.ad-image .expand-icon{position:absolute;top:8px;right:8px;width:32px;height:32px;
  background:rgba(0,0,0,.6);border-radius:50%;display:flex;align-items:center;
  justify-content:center;opacity:0;transition:opacity .2s}
.ad-image:hover .expand-icon{opacity:1}
.expand-icon svg{width:16px;height:16px;fill:#fff}

/* Link preview bar */
.ad-link{background:#F0F2F5;padding:12px 16px;display:flex;align-items:center;gap:12px}
.link-info{flex:1;min-width:0}
.link-domain{font-size:12px;color:#65676B;text-transform:uppercase;letter-spacing:.3px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.link-headline{font-size:15px;font-weight:600;color:#050505;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.link-desc{font-size:13px;color:#65676B;margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cta-btn{flex-shrink:0;padding:8px 16px;background:#E4E6EB;color:#050505;font-weight:600;
  font-size:14px;border:none;border-radius:6px;cursor:default;white-space:nowrap}

/* Meta badges */
.ad-badges{padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid #E4E6EB}
.badge{font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;text-transform:uppercase;
  letter-spacing:.3px;white-space:nowrap}
.badge-hook{background:#EBF5FB;color:#1877F2}
.badge-template{background:#F0F2F5;color:#65676B}
.badge-tof{background:#E8F5E9;color:#2E7D32}
.badge-mof{background:#FFF3E0;color:#E65100}
.badge-bof{background:#FCE4EC;color:#C62828}
.badge-adset{background:#F3E5F5;color:#7B1FA2}

/* Hook type colors */
.badge-CURIOSITY{background:#EBF5FB;color:#1565C0}
.badge-PROOF{background:#E8F5E9;color:#2E7D32}
.badge-CONTRAST{background:#FFF3E0;color:#E65100}
.badge-MECHANISM{background:#F3E5F5;color:#7B1FA2}
.badge-STORY{background:#E0F7FA;color:#00838F}
.badge-OFFER{background:#FCE4EC;color:#C62828}
.badge-PAIN{background:#FBE9E7;color:#BF360C}
.badge-NARRATIVE{background:#E8EAF6;color:#283593}
.badge-URGENCY{background:#FFFDE7;color:#F57F17}
.badge-SOCIAL{background:#E8F5E9;color:#1B5E20}
.badge-AUTHORITY{background:#EFEBE9;color:#4E342E}

/* ── Lightbox ───────────────────────────────────────────────── */
.lightbox{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.85);
  align-items:center;justify-content:center;cursor:zoom-out;padding:24px}
.lightbox.open{display:flex}
.lightbox img{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;cursor:default}
.lightbox-close{position:absolute;top:16px;right:20px;color:#fff;font-size:32px;
  cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.15);border-radius:50%;transition:background .15s}
.lightbox-close:hover{background:rgba(255,255,255,.3)}

/* ── Empty state ────────────────────────────────────────────── */
.empty-state{grid-column:1/-1;text-align:center;padding:80px 20px}
.empty-state p{color:#65676B;font-size:15px;margin-top:8px}
</style>
</head>
<body>

<!-- ── Toolbar ──────────────────────────────────────────────── -->
<div class="toolbar">
  <div class="toolbar-inner">
    <div class="toolbar-top">
      <div class="toolbar-brand">
        ${hasLogo
          ? `<img class="brand-logo-sm" src="${logoRelPath}" alt="${brandName}">`
          : `<div class="brand-initials-sm">${brandInitials}</div>`
        }
        <div>
          <div class="toolbar-title">Ad Library <span class="toolbar-batch">— ${brandName} ${batchId}</span></div>
        </div>
      </div>
      <div class="toolbar-count" id="adCount">${ads.length} ads</div>
    </div>
    <div class="filters">
      <input type="search" class="search-box" id="searchInput" placeholder="Search ads...">
      <div class="filter-sep"></div>
      ${hasFunnel ? `
      <div class="pill-group" id="funnelFilter">
        <button class="pill active" data-funnel="all">All</button>
        <button class="pill" data-funnel="TOF">Cold</button>
        <button class="pill" data-funnel="MOF">Warm</button>
        <button class="pill" data-funnel="BOF">Retarget</button>
      </div>
      <div class="filter-sep"></div>
      ` : ""}
      <select class="filter-select" id="hookFilter">
        <option value="">All Hooks</option>
        ${hookTypes.map((h) => `<option value="${h}">${h}</option>`).join("")}
      </select>
      <select class="filter-select" id="templateFilter">
        <option value="">All Templates</option>
        ${templates.map((t) => `<option value="${t}">${t}</option>`).join("")}
      </select>
      <div class="filter-sep"></div>
      <div class="pill-group" id="ratioToggle">
        <button class="pill active" data-ratio="1x1">Feed (1:1)</button>
        <button class="pill" data-ratio="9x16">Stories (9:16)</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Grid ─────────────────────────────────────────────────── -->
<div class="grid" id="adGrid"></div>

<!-- ── Lightbox ─────────────────────────────────────────────── -->
<div class="lightbox" id="lightbox">
  <div class="lightbox-close" id="lightboxClose">&times;</div>
  <img id="lightboxImg" src="" alt="Ad preview">
</div>

<script>
// ── Data ────────────────────────────────────────────────────
const ADS = ${JSON.stringify(ads)};
const BRAND_NAME = ${JSON.stringify(brandName)};
const BRAND_INITIALS = ${JSON.stringify(brandInitials)};
const HAS_LOGO = ${hasLogo};
const LOGO_PATH = ${JSON.stringify(logoRelPath)};
const HAS_FUNNEL = ${hasFunnel};

// ── CTA mapping ─────────────────────────────────────────────
const CTA_LABELS = {
  LEARN_MORE:"Learn more", BOOK_NOW:"Book now", SIGN_UP:"Sign up",
  SHOP_NOW:"Shop now", SUBSCRIBE:"Subscribe", DOWNLOAD:"Download",
  GET_OFFER:"Get offer", APPLY_NOW:"Apply now", CONTACT_US:"Contact us",
  ORDER_NOW:"Order now", GET_QUOTE:"Get quote", WATCH_MORE:"Watch more",
  SEND_MESSAGE:"Send message", CALL_NOW:"Call now", SEE_MENU:"See menu",
  LISTEN_NOW:"Listen now", GET_STARTED:"Get started"
};

// ── State ───────────────────────────────────────────────────
let currentRatio = "1x1";
let currentFunnel = "all";
let currentHook = "";
let currentTemplate = "";
let searchQuery = "";

// ── DOM refs ────────────────────────────────────────────────
const grid = document.getElementById("adGrid");
const countEl = document.getElementById("adCount");
const searchInput = document.getElementById("searchInput");
const hookFilter = document.getElementById("hookFilter");
const templateFilter = document.getElementById("templateFilter");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");

// ── Truncate text ───────────────────────────────────────────
function truncate(text, max) {
  if (text.length <= max) return { short: text, full: null };
  const cut = text.lastIndexOf(" ", max);
  return { short: text.slice(0, cut > 0 ? cut : max), full: text };
}

// ── Render card ─────────────────────────────────────────────
function renderCard(ad) {
  const imgSrc = currentRatio === "9x16" ? ad.image9x16 : ad.image1x1;
  if (!imgSrc) return "";
  const t = truncate(ad.primaryText, 125);
  const ctaLabel = CTA_LABELS[ad.cta] || ad.cta.replace(/_/g, " ").toLowerCase().replace(/\\b\\w/g, c => c.toUpperCase());
  const hookClass = "badge-" + (ad.hookType || "").replace(/[^A-Z]/g, "");
  const funnelClass = "badge-" + ad.funnel.toLowerCase();

  return \`<div class="ad-card" data-funnel="\${ad.funnel}" data-hook="\${ad.hookType}" data-template="\${ad.template}">
    <div class="ad-header">
      <div class="brand-avatar">
        \${HAS_LOGO
          ? '<img src="' + LOGO_PATH + '" alt="' + BRAND_NAME + '">'
          : '<span class="brand-avatar-initials">' + BRAND_INITIALS + '</span>'
        }
      </div>
      <div class="brand-meta">
        <div class="brand-meta-name">\${BRAND_NAME}</div>
        <div class="brand-meta-sub">Sponsored</div>
      </div>
      <div class="ad-header-menu">&#x22EF;</div>
    </div>
    <div class="ad-text\${t.full ? '' : ' expanded'}" onclick="this.classList.toggle('expanded')">
      <span class="ad-text-truncated">\${esc(t.short)}\${t.full ? '... <span class=\\"see-more\\">See more</span>' : ''}</span>
      \${t.full ? '<span class="ad-text-full">' + esc(t.full) + '</span>' : ''}
    </div>
    <div class="ad-image ratio-\${currentRatio}" onclick="openLightbox('\${imgSrc}')">
      <img src="\${imgSrc}" alt="\${ad.template}" loading="lazy">
      <div class="expand-icon"><svg viewBox="0 0 24 24"><path d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm18 0v7h-7v-2h5v-5h2z"/></svg></div>
    </div>
    <div class="ad-link">
      <div class="link-info">
        <div class="link-domain">\${esc(ad.domain)}</div>
        <div class="link-headline">\${esc(ad.headline)}</div>
        <div class="link-desc">\${esc(ad.description)}</div>
      </div>
      <button class="cta-btn">\${esc(ctaLabel)}</button>
    </div>
    <div class="ad-badges">
      <span class="badge \${hookClass}">\${esc(ad.hookType)}</span>
      <span class="badge badge-template">\${esc(ad.template)}</span>
      \${HAS_FUNNEL ? '<span class="badge ' + funnelClass + '">' + ad.funnel + '</span>' : ''}
      <span class="badge badge-adset">\${esc(ad.adSetName)}</span>
    </div>
  </div>\`;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Filter & render ─────────────────────────────────────────
function render() {
  const q = searchQuery.toLowerCase();
  const filtered = ADS.filter((ad) => {
    if (currentFunnel !== "all" && ad.funnel !== currentFunnel) return false;
    if (currentHook && ad.hookType !== currentHook) return false;
    if (currentTemplate && ad.template !== currentTemplate) return false;
    if (q) {
      const hay = (ad.primaryText + " " + ad.headline + " " + ad.description + " " + ad.adName + " " + ad.template + " " + ad.hookType).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Make sure the image exists for the current ratio
    const img = currentRatio === "9x16" ? ad.image9x16 : ad.image1x1;
    if (!img) return false;
    return true;
  });

  countEl.textContent = filtered.length + " ad" + (filtered.length !== 1 ? "s" : "");

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="no-results"><h3>No ads match your filters</h3><p>Try adjusting your search or filters.</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(renderCard).join("");
}

// ── Event listeners ─────────────────────────────────────────

// Search
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  render();
});

// Funnel pills
const funnelBtns = document.querySelectorAll("#funnelFilter .pill");
funnelBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    funnelBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFunnel = btn.dataset.funnel;
    render();
  });
});

// Ratio toggle
const ratioBtns = document.querySelectorAll("#ratioToggle .pill");
ratioBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    ratioBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRatio = btn.dataset.ratio;
    grid.classList.toggle("stories-mode", currentRatio === "9x16");
    render();
  });
});

// Hook filter
hookFilter.addEventListener("change", (e) => {
  currentHook = e.target.value;
  render();
});

// Template filter
templateFilter.addEventListener("change", (e) => {
  currentTemplate = e.target.value;
  render();
});

// Lightbox
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add("open");
}
document.getElementById("lightboxClose").addEventListener("click", () => {
  lightbox.classList.remove("open");
});
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) lightbox.classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") lightbox.classList.remove("open");
});

// ── Initial render ──────────────────────────────────────────
render();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Write and optionally open
// ---------------------------------------------------------------------------

const outPath = join(outputDir, "ad-library.html");
writeFileSync(outPath, html, "utf-8");
console.log(`\nWrote: ${outPath}`);

if (args.open) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${outPath}"`
      : process.platform === "darwin"
      ? `open "${outPath}"`
      : `xdg-open "${outPath}"`;
  exec(cmd, (err) => {
    if (err) console.error("Could not open browser:", err.message);
  });
}
