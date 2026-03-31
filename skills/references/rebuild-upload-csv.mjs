/**
 * rebuild-upload-csv.mjs
 * Merges a dual-row (1x1 + 9x16) upload.csv into single rows with two image columns.
 * Outputs upload-2.xlsx (Excel) and copies selected images to Ad-uploads/.
 *
 * Usage:
 *   node skills/references/rebuild-upload-csv.mjs --output-dir brands/{name}/outputs/3-16-26-V12
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { parseArgs } from 'util';
import XLSX from 'xlsx';

const { values } = parseArgs({
  options: { 'output-dir': { type: 'string' } },
});

const outputDir = values['output-dir'];
if (!outputDir) {
  console.error('Usage: node rebuild-upload-csv.mjs --output-dir <path>');
  process.exit(1);
}

// ── CSV parser (handles quoted fields with commas/newlines) ──────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuote = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      field += ch;
    } else {
      if (ch === '"') { inQuote = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch;
    }
    i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Em dashes (—) break some CSV importers — replace with plain hyphen
function sanitize(v) {
  if (v == null) return '';
  return String(v).replace(/\u2014/g, '-');
}

function csvField(v) {
  const s = sanitize(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Load files ───────────────────────────────────────────────────────────────
const csvPath = join(outputDir, 'upload.csv');
const selectionsPath = join(outputDir, 'selections.json');

const rawCSV = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''); // strip BOM if present
const selections = JSON.parse(readFileSync(selectionsPath, 'utf8'));

const [header, ...dataRows] = parseCSV(rawCSV);
const col = (name) => header.indexOf(name);

// Map column indices
const C = {
  campaign:   col('Campaign Name'),
  adSet:      col('Ad Set Name'),
  adName:     col('Ad Name'),
  primaryText:col('Primary Text'),
  headline:   col('Headline'),
  description:col('Description'),
  cta:        col('Call to Action'),
  url:        col('Website URL'),
  image:      col('Image File Name'),
  hookType:   col('Hook Type'),
  template:   col('Template'),
  aspectRatio:col('Aspect Ratio'),
  batchId:    col('Batch ID'),
};

// ── Group rows by template, split by aspect ratio ────────────────────────────
const byTemplate = {};
for (const row of dataRows) {
  if (!row || row.length < 5) continue;
  const tpl = row[C.template];
  const ratio = row[C.aspectRatio];
  if (!tpl) continue;
  if (!byTemplate[tpl]) byTemplate[tpl] = {};
  byTemplate[tpl][ratio] = row;
}

// ── Build new header ─────────────────────────────────────────────────────────
const newHeader = [
  'Campaign Name',
  'Ad Set Name',
  'Ad Name',
  'Primary Text',
  'Headline',
  'Description',
  'Call to Action',
  'Website URL',
  'Image File Name (1x1)',
  'Image File Name (9x16)',
  'Hook Type',
  'Template',
  'Batch ID',
];

// ── Build 40 output rows ─────────────────────────────────────────────────────
const outputRows = [];

for (const [tplKey, ratioMap] of Object.entries(byTemplate)) {
  const r1x1 = ratioMap['1x1'];
  const r9x16 = ratioMap['9x16'];
  const base = r1x1 || r9x16; // use 1x1 as primary copy source

  // Strip ratio from ad name: MTX_01-headline_1x1_CURIOSITY_V12 → MTX_01-headline_CURIOSITY_V12
  const adName = base[C.adName].replace(/_1x1_|_9x16_/, '_');

  // Fix URL if needed (customize per brand)
  const url = base[C.url];

  // Image paths from selections.json (authoritative) — flatten to basename for Ad-uploads/
  // Strip _v# suffix so 1x1 and 9x16 filenames match for Ads Uploader pairing
  const stripVersion = (name) => name.replace(/_v\d+(?=\.\w+$)/, '');
  const selKey = Object.keys(selections).find(k => tplKey.startsWith(k) || k === tplKey);
  const img1x1 = selKey ? stripVersion(basename(selections[selKey]['1x1'])) : (r1x1 ? stripVersion(basename(r1x1[C.image])) : '');
  const img9x16 = selKey ? stripVersion(basename(selections[selKey]['9x16'])) : (r9x16 ? stripVersion(basename(r9x16[C.image])) : '');

  outputRows.push([
    base[C.campaign],
    base[C.adSet],
    adName,
    base[C.primaryText],
    base[C.headline],
    base[C.description],
    base[C.cta],
    url,
    img1x1,
    img9x16,
    base[C.hookType],
    tplKey,
    base[C.batchId],
  ]);
}

// ── Write upload-2.xlsx ──────────────────────────────────────────────────────
const wsData = [newHeader, ...outputRows.map(row => row.map(sanitize))];
const ws = XLSX.utils.aoa_to_sheet(wsData);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Ads');
const outXLSXPath = join(outputDir, 'upload-2.xlsx');
XLSX.writeFile(wb, outXLSXPath);
console.log(`✓ upload-2.xlsx written — ${outputRows.length} rows`);

// ── Copy selected images to Ad-uploads/ ──────────────────────────────────────
const adUploadsDir = join(outputDir, 'Ad-uploads');
mkdirSync(adUploadsDir, { recursive: true });

let copied = 0;
for (const [tpl, paths] of Object.entries(selections)) {
  for (const [ratio, relPath] of Object.entries(paths)) {
    const src = join(outputDir, relPath);
    // Strip _v# suffix so 1x1 and 9x16 filenames match for Ads Uploader pairing
    const destName = basename(relPath).replace(/_v\d+(?=\.\w+$)/, '');
    const dest = join(adUploadsDir, destName);
    if (existsSync(src)) {
      copyFileSync(src, dest);
      copied++;
    } else {
      console.warn(`  MISSING: ${relPath}`);
    }
  }
}
console.log(`✓ Ad-uploads/ created — ${copied} images copied`);
console.log(`\nDone! Files written to: ${outputDir}`);
