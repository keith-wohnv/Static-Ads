#!/usr/bin/env node
/**
 * gallery-selector.mjs
 *
 * Scans an ad output folder, builds (or rebuilds) gallery.html with a
 * radio-button selection UI so you can manually pick the best image for
 * each template × ratio combination.
 *
 * When you're done picking, click "Save Selections" → writes selections.json
 * next to gallery.html.  The ad-copy-builder skill reads that file to know
 * which images to include in the Ads Uploader CSV.
 *
 * Usage:
 *   node skills/references/gallery-selector.mjs --output-dir brands/{name}/outputs/3-16-26-V10
 *   node skills/references/gallery-selector.mjs --output-dir brands/{name}/outputs/3-16-26-V10 --open
 */

import { readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join, relative, basename, extname } from "path";
import { parseArgs } from "util";
import { exec } from "child_process";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const RATIO_FOLDERS = ["1x1", "9x16", "4x5", "16x9"]; // all known ratio folder names

// ---------------------------------------------------------------------------
// Scan output dir
// ---------------------------------------------------------------------------

function scanOutputDir(outputDir) {
  const templates = [];

  const entries = readdirSync(outputDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{2}-/.test(name)) // only numbered template folders
    .sort();

  for (const folderName of entries) {
    const templatePath = join(outputDir, folderName);
    const match = folderName.match(/^(\d+)-(.+)$/);
    if (!match) continue;

    const templateNum = match[1];
    const templateSlug = match[2];
    const templateTitle = templateSlug.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Find prompt.txt if it exists
    const promptPath = join(templatePath, "prompt.txt");
    const hasPrompt = existsSync(promptPath);

    const ratios = [];

    // Check ratio sub-folders first
    const subDirs = readdirSync(templatePath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const knownRatios = subDirs.filter((d) => RATIO_FOLDERS.includes(d));

    if (knownRatios.length > 0) {
      for (const ratio of RATIO_FOLDERS.filter((r) => knownRatios.includes(r))) {
        const ratioPath = join(templatePath, ratio);
        const images = readdirSync(ratioPath)
          .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
          .sort();
        if (images.length > 0) {
          ratios.push({ ratio, images });
        }
      }
    } else {
      // Images directly in template folder (flat structure)
      const images = readdirSync(templatePath)
        .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
        .sort();
      if (images.length > 0) {
        ratios.push({ ratio: "1x1", images }); // assume 1x1 if no ratio subfolder
      }
    }

    if (ratios.length > 0) {
      templates.push({ folderName, templateNum, templateTitle, ratios });
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Build gallery HTML with selection UI
// ---------------------------------------------------------------------------

function buildGalleryHtml(outputDir, templates, brandName) {
  const totalImages = templates.reduce(
    (sum, t) => sum + t.ratios.reduce((s, r) => s + r.images.length, 0),
    0
  );
  const totalSelections = templates.reduce((sum, t) => sum + t.ratios.length, 0);
  const timestamp = new Date().toLocaleString();

  const groupsPerTemplateObj = {};
  for (const t of templates) {
    groupsPerTemplateObj[t.folderName] = t.ratios.length;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${brandName} — Ad Selector</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0a0a0a; color: #fff; padding: 0; }

        /* ── Sticky toolbar ── */
        #toolbar {
            position: sticky; top: 0; z-index: 100;
            background: #111; border-bottom: 1px solid #222;
            padding: 0.85rem 2rem;
            display: flex; align-items: center; justify-content: space-between;
            gap: 1rem;
        }
        #toolbar .left { display: flex; align-items: center; gap: 1rem; }
        #toolbar h1 { font-size: 1.1rem; white-space: nowrap; }
        #progress {
            font-size: 0.85rem; color: #888;
            background: #1a1a1a; border-radius: 20px;
            padding: 0.25rem 0.75rem;
        }
        #progress.done { color: #4ade80; background: #052e16; }
        #save-btn {
            background: #16a34a; color: #fff;
            border: none; border-radius: 6px;
            padding: 0.55rem 1.4rem; font-size: 0.95rem; font-weight: 600;
            cursor: pointer; white-space: nowrap;
            transition: background 0.15s;
        }
        #save-btn:hover { background: #15803d; }
        #save-btn:disabled { background: #333; color: #666; cursor: default; }
        #saved-msg { color: #4ade80; font-size: 0.85rem; display: none; }

        /* ── Page content ── */
        .content { padding: 2rem; }
        .subtitle { text-align: center; color: #555; margin-bottom: 2.5rem; font-size: 0.9rem; }
        .template-section { margin-bottom: 3rem; }
        .template-header {
            font-size: 1.2rem; margin-bottom: 1rem; padding-bottom: 0.5rem;
            border-bottom: 1px solid #222;
        }
        .template-header span { color: #555; font-weight: normal; font-size: 0.85rem; margin-left: 0.5rem; }
        .ratio-section { margin-bottom: 1.75rem; }
        .ratio-label {
            display: flex; align-items: center; gap: 0.5rem;
            font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;
        }
        .ratio-label .badge {
            background: #222; color: #ccc;
            padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem;
        }
        .ratio-label .pick-status { font-size: 0.78rem; color: #555; }
        .ratio-label .pick-status.selected { color: #4ade80; }

        /* ── Image cards ── */
        .image-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1rem;
        }
        .image-card {
            background: #1a1a1a; border-radius: 8px; overflow: hidden;
            border: 3px solid transparent;
            cursor: pointer; transition: border-color 0.15s, transform 0.1s;
            position: relative;
        }
        .image-card:hover { border-color: #444; transform: translateY(-1px); }
        .image-card.selected { border-color: #16a34a !important; }
        .image-card.selected .radio-dot { background: #16a34a; }

        /* Radio dot indicator */
        .radio-dot {
            position: absolute; top: 10px; right: 10px;
            width: 22px; height: 22px; border-radius: 50%;
            background: #333; border: 2px solid #555;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.15s, border-color 0.15s;
            z-index: 10;
        }
        .image-card.selected .radio-dot { border-color: #16a34a; }
        .radio-dot::after {
            content: ''; width: 10px; height: 10px; border-radius: 50%;
            background: transparent; transition: background 0.15s;
        }
        .image-card.selected .radio-dot::after { background: #fff; }

        /* Expand / full-size button */
        .expand-btn {
            position: absolute; top: 10px; left: 10px;
            width: 28px; height: 28px; border-radius: 6px;
            background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.15s;
            z-index: 10; text-decoration: none; color: #fff; font-size: 14px;
        }
        .image-card:hover .expand-btn { opacity: 1; }

        .image-card img {
            width: 100%; height: auto; display: block;
            transition: opacity 0.15s;
        }
        .image-card:not(.selected) img { opacity: 0.7; }
        .image-card.selected img { opacity: 1; }
        .image-card .info {
            padding: 0.6rem 0.75rem; font-size: 0.8rem; color: #666;
            display: flex; align-items: center; justify-content: space-between;
        }
        .image-card.selected .info { color: #4ade80; }

        /* Hidden radio inputs */
        input[type="radio"] { display: none; }

        /* ── Excluded state ── */
        .template-section.excluded { opacity: 0.35; }
        .template-section.excluded .template-header { border-bottom-color: #7f1d1d; }
        .exclude-btn {
            font-size: 0.72rem; padding: 0.18rem 0.6rem; margin-left: 0.75rem;
            border: 1px solid #444; border-radius: 4px;
            background: transparent; color: #666; cursor: pointer;
            transition: all 0.15s; vertical-align: middle;
        }
        .exclude-btn:hover { border-color: #ef4444; color: #ef4444; }
        .template-section.excluded .exclude-btn { border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.12); }
        .excluded-badge {
            display: none; background: #7f1d1d; color: #fca5a5;
            font-size: 0.68rem; padding: 0.15rem 0.5rem; border-radius: 4px;
            font-weight: 700; margin-left: 0.5rem; vertical-align: middle; letter-spacing: 0.05em;
        }
        .template-section.excluded .excluded-badge { display: inline; }

        /* ── Toast ── */
        #toast {
            position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
            background: #16a34a; color: #fff; padding: 0.75rem 1.5rem;
            border-radius: 8px; font-size: 0.95rem; font-weight: 600;
            opacity: 0; transition: opacity 0.3s;
            pointer-events: none; white-space: nowrap; z-index: 999;
        }
        #toast.show { opacity: 1; }

        /* ── Lightbox ── */
        #lightbox {
            display: none; position: fixed; inset: 0; z-index: 1000;
            background: rgba(0,0,0,0.92);
            align-items: center; justify-content: center;
            cursor: zoom-out;
        }
        #lightbox.open { display: flex; }
        #lightbox img {
            max-width: 92vw; max-height: 92vh;
            object-fit: contain; border-radius: 4px;
            cursor: default; box-shadow: 0 0 60px rgba(0,0,0,0.8);
        }
        #lightbox-close {
            position: fixed; top: 1.25rem; right: 1.5rem;
            background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
            color: #fff; border-radius: 6px; width: 36px; height: 36px;
            font-size: 1.2rem; cursor: pointer; display: flex;
            align-items: center; justify-content: center;
        }
        #lightbox-close:hover { background: rgba(255,255,255,0.22); }
    </style>
</head>
<body>
    <div id="toolbar">
        <div class="left">
            <h1>${brandName} — Ad Image Selector</h1>
            <div id="progress">0 / ${totalSelections} selected</div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
            <span id="saved-msg">✓ selections.json saved</span>
            <button id="save-btn">Save Selections →</button>
        </div>
    </div>

    <div class="content">
        <p class="subtitle">
            ${totalImages} images · ${templates.length} templates · ${timestamp}
            &nbsp;|&nbsp; Click an image to select it for each ratio. One pick per group.
        </p>

${templates.map((t) => `        <div class="template-section" id="section-${t.folderName}">
            <h2 class="template-header">
                #${t.templateNum.padStart(2, "0")} ${t.templateTitle}
                <span>${t.ratios.reduce((s, r) => s + r.images.length, 0)} images</span>
                <button class="exclude-btn" id="exclude-btn-${t.folderName}" onclick="toggleExclude('${t.folderName}')">Exclude</button>
                <span class="excluded-badge">EXCLUDED</span>
            </h2>
${t.ratios.map((r) => {
  const groupId = `${t.folderName}-${r.ratio}`;
  return `            <div class="ratio-section" data-group="${groupId}">
                <div class="ratio-label">
                    <span class="badge">${r.ratio === "1x1" ? "1:1" : r.ratio === "9x16" ? "9:16" : r.ratio}</span>
                    <span class="pick-status" id="status-${groupId}">— none selected</span>
                </div>
                <div class="image-grid">
${r.images.map((img, idx) => {
  const hasRatioFolder = r.ratio !== "flat";
  const imgPath = hasRatioFolder
    ? `${t.folderName}/${r.ratio}/${img}`
    : `${t.folderName}/${img}`;
  const cardId = `card-${t.folderName}-${r.ratio}-${idx}`;
  const isDefault = idx === 0;
  return `                    <div class="image-card${isDefault ? " selected" : ""}" id="${cardId}"
                         data-group="${groupId}"
                         data-path="${imgPath}"
                         data-filename="${img}"
                         onclick="selectCard('${groupId}', '${cardId}', '${imgPath}', '${img}')">
                        <button class="expand-btn" onclick="event.stopPropagation(); openLightbox('${imgPath}')" title="View full size">⤢</button>
                        <div class="radio-dot"></div>
                        <img src="${imgPath}" alt="${t.templateTitle} ${r.ratio} v${idx + 1}" loading="lazy">
                        <div class="info">
                            <span>${img}</span>
                            <span>v${idx + 1}</span>
                        </div>
                    </div>`;
}).join("\n")}
                </div>
            </div>`;
}).join("\n")}
        </div>`).join("\n")}
    </div>

    <div id="toast">✓ Selections saved to selections.json</div>

    <div id="lightbox" onclick="closeLightbox()">
        <button id="lightbox-close" onclick="closeLightbox()">✕</button>
        <img id="lightbox-img" src="" alt="" onclick="event.stopPropagation()">
    </div>

    <script>
        // ── State ──
        const selections = {};
        const excluded = new Set();
        const groupsPerTemplate = ${JSON.stringify(groupsPerTemplateObj)};

        // ── Init defaults (v1 for each group) ──
        document.querySelectorAll('.image-card.selected').forEach(card => {
            const group = card.dataset.group;
            selections[group] = { path: card.dataset.path, filename: card.dataset.filename };
        });
        updateProgress();

        function templateFromGroupId(groupId) {
            for (const tmpl of Object.keys(groupsPerTemplate)) {
                if (groupId.startsWith(tmpl + '-')) return tmpl;
            }
            return groupId.slice(0, groupId.lastIndexOf('-'));
        }

        function selectCard(groupId, cardId, imgPath, filename) {
            document.querySelectorAll(\`.image-card[data-group="\${groupId}"]\`).forEach(c => {
                c.classList.remove('selected');
            });
            const card = document.getElementById(cardId);
            card.classList.add('selected');
            selections[groupId] = { path: imgPath, filename };
            const statusEl = document.getElementById('status-' + groupId);
            statusEl.textContent = '✓ ' + filename;
            statusEl.classList.add('selected');
            updateProgress();
        }

        function toggleExclude(folderName) {
            const section = document.getElementById('section-' + folderName);
            const btn = document.getElementById('exclude-btn-' + folderName);
            if (excluded.has(folderName)) {
                excluded.delete(folderName);
                section.classList.remove('excluded');
                btn.textContent = 'Exclude';
            } else {
                excluded.add(folderName);
                section.classList.add('excluded');
                btn.textContent = 'Restore';
            }
            updateProgress();
        }

        function updateProgress() {
            let count = 0;
            let total = 0;
            for (const [tmpl, groupCount] of Object.entries(groupsPerTemplate)) {
                if (!excluded.has(tmpl)) total += groupCount;
            }
            for (const groupId of Object.keys(selections)) {
                if (!excluded.has(templateFromGroupId(groupId))) count++;
            }
            const el = document.getElementById('progress');
            el.textContent = count + ' / ' + total + ' selected';
            el.classList.toggle('done', total > 0 && count >= total);
        }

        // ── Lightbox ──
        function openLightbox(src) {
            document.getElementById('lightbox-img').src = src;
            document.getElementById('lightbox').classList.add('open');
        }
        function closeLightbox() {
            document.getElementById('lightbox').classList.remove('open');
            document.getElementById('lightbox-img').src = '';
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeLightbox();
        });

        // ── Save Selections ──
        document.getElementById('save-btn').addEventListener('click', () => {
            const output = { excluded: [...excluded].sort() };
            for (const [groupId, sel] of Object.entries(selections)) {
                if (excluded.has(templateFromGroupId(groupId))) continue;
                const lastDash = groupId.lastIndexOf('-');
                const template = groupId.slice(0, lastDash);
                const ratio = groupId.slice(lastDash + 1);
                if (!output[template]) output[template] = {};
                output[template][ratio] = sel.path;
            }

            const json = JSON.stringify(output, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'selections.json';
            a.click();
            URL.revokeObjectURL(url);

            document.getElementById('saved-msg').style.display = 'block';
            const toast = document.getElementById('toast');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        });
    </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      "output-dir": { type: "string" },
      "open": { type: "boolean", default: false },
    },
    strict: false,
  });

  const outputDir = values["output-dir"];
  if (!outputDir) {
    console.error("Usage: node gallery-selector.mjs --output-dir brands/{name}/outputs/{version}");
    process.exit(1);
  }

  if (!existsSync(outputDir)) {
    console.error(`Output dir not found: ${outputDir}`);
    process.exit(1);
  }

  // Infer brand name from path (e.g. brands/{name}/outputs/...)
  const parts = outputDir.replace(/\\/g, "/").split("/");
  const brandsIdx = parts.findIndex((p) => p === "brands");
  const brandSlug = brandsIdx >= 0 ? parts[brandsIdx + 1] : basename(outputDir);
  const brandName = brandSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  console.log(`Scanning: ${outputDir}`);
  const templates = scanOutputDir(outputDir);

  if (templates.length === 0) {
    console.error("No template folders with images found.");
    process.exit(1);
  }

  const totalImages = templates.reduce(
    (sum, t) => sum + t.ratios.reduce((s, r) => s + r.images.length, 0),
    0
  );
  console.log(`Found ${templates.length} templates, ${totalImages} images`);

  const html = buildGalleryHtml(outputDir, templates, brandName);
  const galleryPath = join(outputDir, "gallery.html");
  writeFileSync(galleryPath, html, "utf-8");
  console.log(`\nGallery saved → ${galleryPath}`);
  console.log("\nInstructions:");
  console.log("  1. Open gallery.html in your browser");
  console.log("  2. Click each image to select the best one per group");
  console.log("  3. Click 'Save Selections →' — downloads selections.json");
  console.log("  4. Move selections.json into:", outputDir);
  console.log("  5. Run: /ad-copy-builder --brand {name} --output-dir", outputDir);

  if (values["open"]) {
    const platform = process.platform;
    const cmd = platform === "win32" ? `start "" "${galleryPath}"` :
                platform === "darwin" ? `open "${galleryPath}"` :
                `xdg-open "${galleryPath}"`;
    exec(cmd);
    console.log("\nOpening gallery in browser...");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
