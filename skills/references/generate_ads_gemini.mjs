#!/usr/bin/env node
/**
 * Static Ad Generator - Google Gemini API Integration
 * Generates static ad images using Gemini 3.1 Flash (image editing) via REST API.
 *
 * Usage:
 *   node generate_ads_gemini.mjs --brand-dir brands/{name}                              # Full run (all templates, 4 imgs, both ratios)
 *   node generate_ads_gemini.mjs --brand-dir brands/{name} --templates 1,7,13 --num-images 1  # Cheap test
 *   node generate_ads_gemini.mjs --brand-dir brands/{name} --max-concurrent 5            # Control parallelism
 *   node generate_ads_gemini.mjs --brand-dir brands/{name} --ratios 1x1                  # Single ratio only
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, extname, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_NUM_IMAGES = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;
const REQUEST_DELAY_MS = 2000; // Delay between requests to avoid rate limits

/**
 * Load GEMINI_KEY from environment or .env file
 */
function loadGeminiKey() {
  if (process.env.GEMINI_KEY) return process.env.GEMINI_KEY;

  const envPaths = [
    resolve(__dirname, "..", "..", ".env"),
    resolve(process.cwd(), ".env"),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("GEMINI_KEY=")) {
          return trimmed.slice("GEMINI_KEY=".length).trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  return "";
}

const GEMINI_KEY = loadGeminiKey();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Load a local image as base64 inline_data for Gemini API
 */
function loadImageAsInlineData(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "image/png";
  const data = readFileSync(filePath).toString("base64");
  return { inline_data: { mime_type: mimeType, data } };
}

// ---------------------------------------------------------------------------
// Gemini API
// ---------------------------------------------------------------------------

/**
 * Call Gemini generateContent with text + reference images.
 * Returns the generated image as a Buffer, or null on failure.
 */
async function generateImage(prompt, referenceImageParts) {
  const parts = [
    { text: prompt },
    ...referenceImageParts,
  ];

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const url = `${GEMINI_URL}?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const candidates = data.candidates || [];
  if (candidates.length === 0) {
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Blocked by safety filter: ${blockReason}`);
    throw new Error("No candidates returned");
  }

  const contentParts = candidates[0].content?.parts || [];

  // Extract the first image from response parts
  for (const part of contentParts) {
    if (part.inlineData || part.inline_data) {
      const inlineData = part.inlineData || part.inline_data;
      const buffer = Buffer.from(inlineData.data, "base64");
      const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
      const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
      return { buffer, ext, mimeType };
    }
  }

  // Check if there was text explaining why no image was generated
  for (const part of contentParts) {
    if (part.text) {
      throw new Error(`Gemini returned text instead of image: ${part.text.slice(0, 200)}`);
    }
  }

  throw new Error("No image found in Gemini response");
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { ratio: "1:1", folder: "1x1", instruction: "The output image MUST be square (1:1 aspect ratio)." },
  { ratio: "9:16", folder: "9x16", instruction: "The output image MUST be vertical/portrait (9:16 aspect ratio, taller than wide). IMPORTANT for vertical format: Keep the top ~15% and bottom ~25% of the image free of text, logos, and key visual elements — this area gets covered by platform UI (profile icons, captions, CTA buttons) on Meta Stories and Reels placements. Center all critical copy and branding in the middle 60% of the frame vertically." },
];

/**
 * Run a single job: generate one image for one template + one ratio.
 */
async function runSingleImage(promptData, referenceImageParts, outputDir, ratio, ratioFolder, ratioInstruction, imageIdx) {
  const templateNum = promptData.template_number;
  const templateName = promptData.template_name;
  const label = `[${String(templateNum).padStart(2, "0")}] ${templateName} ${ratio} v${imageIdx + 1}`;

  const folderName = `${String(templateNum).padStart(2, "0")}-${templateName}`;
  const templateDir = join(outputDir, folderName);
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, "prompt.txt"), promptData.prompt, "utf-8");

  const ratioDir = join(templateDir, ratioFolder);
  mkdirSync(ratioDir, { recursive: true });

  // Append aspect ratio instruction to the prompt
  const fullPrompt = `${promptData.prompt}\n\n${ratioInstruction}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`  ${label} — generating (attempt ${attempt})...`);
      const result = await generateImage(fullPrompt, referenceImageParts);

      const filename = `${templateName}_${ratioFolder}_v${imageIdx + 1}.${result.ext}`;
      const savePath = join(ratioDir, filename);
      writeFileSync(savePath, result.buffer);

      console.log(`  ${label} — DONE (${(result.buffer.length / 1024).toFixed(0)} KB)`);
      return { filename, ratioFolder, ratio, width: null, height: null };
    } catch (err) {
      const isRetryable = err.message.includes("429") || err.message.includes("500") || err.message.includes("503") || err.message.includes("overloaded");
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        console.warn(`  ${label} — failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message.slice(0, 100)}`);
        console.warn(`  ${label} — retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Run all images for one template + one ratio.
 */
async function runJob(promptData, allRefParts, promptRefParts, outputDir, numImages, ratio, ratioFolder, ratioInstruction) {
  const refParts = promptRefParts.length > 0 ? promptRefParts : allRefParts;
  const downloaded = [];

  for (let i = 0; i < numImages; i++) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);
    try {
      const img = await runSingleImage(promptData, refParts, outputDir, ratio, ratioFolder, ratioInstruction, i);
      downloaded.push(img);
    } catch (err) {
      console.error(`  ERROR [${promptData.template_name} ${ratio} v${i + 1}]: ${err.message.slice(0, 150)}`);
    }
  }

  return {
    templateNum: promptData.template_number,
    templateName: promptData.template_name,
    folderName: `${String(promptData.template_number).padStart(2, "0")}-${promptData.template_name}`,
    downloaded,
  };
}

/**
 * Generate all templates + ratios with concurrency control.
 */
async function generateAllParallel(prompts, refPartsMap, allRefParts, outputDir, numImages, maxConcurrent, selectedRatios) {
  // Build flat list of jobs (template × ratio)
  const jobs = [];
  for (const promptData of prompts) {
    // Build per-prompt reference image parts
    const promptRefNames = promptData.reference_images || [];
    const promptRefParts = [];
    for (const name of promptRefNames) {
      if (refPartsMap.has(name)) promptRefParts.push(refPartsMap.get(name));
    }

    for (const { ratio, folder: ratioFolder, instruction } of selectedRatios) {
      jobs.push({ promptData, promptRefParts, ratio, ratioFolder, instruction });
    }
  }

  const totalImages = jobs.length * numImages;
  console.log(`\nDispatching ${jobs.length} jobs (${totalImages} total images, max ${maxConcurrent} concurrent)...\n`);

  // Semaphore-based concurrency limiter
  let active = 0;
  let idx = 0;
  const jobResults = new Array(jobs.length);

  await new Promise((resolveAll) => {
    let settled = 0;

    function launchNext() {
      while (active < maxConcurrent && idx < jobs.length) {
        const jobIdx = idx++;
        const job = jobs[jobIdx];
        active++;

        runJob(job.promptData, allRefParts, job.promptRefParts, outputDir, numImages, job.ratio, job.ratioFolder, job.instruction)
          .then((result) => {
            jobResults[jobIdx] = { ok: true, result };
          })
          .catch((err) => {
            console.error(`  ERROR [${job.promptData.template_name} ${job.ratio}]: ${err.message}`);
            jobResults[jobIdx] = { ok: false, templateNum: job.promptData.template_number, error: err.message };
          })
          .finally(() => {
            active--;
            settled++;
            if (settled === jobs.length) resolveAll();
            else launchNext();
          });
      }
    }

    launchNext();
  });

  // Reassemble per-template results
  const templateMap = new Map();
  const failed = [];

  for (const jr of jobResults) {
    if (!jr.ok) {
      failed.push({ num: jr.templateNum, error: jr.error });
      continue;
    }
    const { templateNum, templateName, folderName, downloaded } = jr.result;
    if (downloaded.length === 0) continue;
    if (!templateMap.has(templateNum)) {
      templateMap.set(templateNum, { template_number: templateNum, template_name: templateName, folder: folderName, images: [] });
    }
    templateMap.get(templateNum).images.push(...downloaded);
  }

  const results = [...templateMap.values()].sort((a, b) => a.template_number - b.template_number);
  return { results, failed };
}

// ---------------------------------------------------------------------------
// HTML Gallery with image selection UI
// ---------------------------------------------------------------------------

function generateGallery(outputDir, results, brandName, selectedRatios) {
  const totalImages = results.reduce((sum, r) => sum + r.images.length, 0);
  const totalGroups = results.reduce((sum, r) => {
    return sum + selectedRatios.filter(({ folder: rf }) =>
      r.images.some((img) => img.ratioFolder === rf)
    ).length;
  }, 0);
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  // Build groupsPerTemplate for dynamic progress counting in the browser
  const groupsPerTemplateObj = {};
  for (const r of results) {
    const count = selectedRatios.filter(({ folder: rf }) =>
      r.images.some((img) => img.ratioFolder === rf)
    ).length;
    groupsPerTemplateObj[r.folder] = count;
  }

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${brandName} — Ad Selector (Gemini)</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0a0a0a; color: #fff; padding: 0; }
        /* ── Sticky toolbar ── */
        #toolbar {
            position: sticky; top: 0; z-index: 100;
            background: #111; border-bottom: 1px solid #222;
            padding: 0.85rem 2rem;
            display: flex; align-items: center; justify-content: space-between; gap: 1rem;
        }
        #toolbar h1 { font-size: 1.1rem; white-space: nowrap; }
        #progress { font-size: 0.85rem; color: #888; background: #1a1a1a;
                    border-radius: 20px; padding: 0.25rem 0.75rem; }
        #progress.done { color: #4ade80; background: #052e16; }
        #save-btn { background: #16a34a; color: #fff; border: none; border-radius: 6px;
                    padding: 0.55rem 1.4rem; font-size: 0.95rem; font-weight: 600;
                    cursor: pointer; transition: background 0.15s; }
        #save-btn:hover { background: #15803d; }
        #saved-msg { color: #4ade80; font-size: 0.85rem; display: none; }
        /* ── Content ── */
        .content { padding: 2rem; }
        .subtitle { text-align: center; color: #555; margin-bottom: 2.5rem; font-size: 0.85rem; }
        .template-section { margin-bottom: 3rem; }
        .template-header { font-size: 1.2rem; margin-bottom: 1rem; padding-bottom: 0.5rem;
                           border-bottom: 1px solid #222; }
        .template-header span { color: #555; font-weight: normal; font-size: 0.85rem; margin-left: 0.5rem; }
        .ratio-section { margin-bottom: 1.75rem; }
        .ratio-label { display: flex; align-items: center; gap: 0.5rem;
                       font-size: 0.9rem; color: #888; margin-bottom: 0.75rem; }
        .ratio-label .badge { background: #222; color: #ccc; padding: 0.15rem 0.5rem;
                              border-radius: 4px; font-size: 0.8rem; }
        .ratio-label .pick-status { font-size: 0.78rem; color: #555; }
        .ratio-label .pick-status.selected { color: #4ade80; }
        /* ── Image cards ── */
        .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
        .image-card { background: #1a1a1a; border-radius: 8px; overflow: hidden;
                      border: 3px solid transparent; cursor: pointer;
                      transition: border-color 0.15s, transform 0.1s; position: relative; }
        .image-card:hover { border-color: #444; transform: translateY(-1px); }
        .image-card.selected { border-color: #16a34a !important; }
        .radio-dot { position: absolute; top: 10px; right: 10px; width: 22px; height: 22px;
                     border-radius: 50%; background: #333; border: 2px solid #555;
                     display: flex; align-items: center; justify-content: center;
                     transition: background 0.15s, border-color 0.15s; z-index: 10; }
        .image-card.selected .radio-dot { border-color: #16a34a; }
        .radio-dot::after { content: ''; width: 10px; height: 10px; border-radius: 50%;
                            background: transparent; transition: background 0.15s; }
        .image-card.selected .radio-dot::after { background: #fff; }
        .expand-btn { position: absolute; top: 10px; left: 10px; width: 28px; height: 28px;
                      border-radius: 6px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15);
                      display: flex; align-items: center; justify-content: center;
                      opacity: 0; transition: opacity 0.15s; z-index: 10;
                      text-decoration: none; color: #fff; font-size: 14px; }
        .image-card:hover .expand-btn { opacity: 1; }
        .image-card img { width: 100%; height: auto; display: block; transition: opacity 0.15s; }
        .image-card:not(.selected) img { opacity: 0.65; }
        .image-card.selected img { opacity: 1; }
        .image-card .info { padding: 0.6rem 0.75rem; font-size: 0.8rem; color: #666;
                            display: flex; align-items: center; justify-content: space-between; }
        .image-card.selected .info { color: #4ade80; }
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
        #toast { position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
                 background: #16a34a; color: #fff; padding: 0.75rem 1.5rem;
                 border-radius: 8px; font-size: 0.95rem; font-weight: 600;
                 opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 999; }
        #toast.show { opacity: 1; }
        /* ── Lightbox ── */
        #lightbox { display: none; position: fixed; inset: 0; z-index: 1000;
                    background: rgba(0,0,0,0.92); align-items: center; justify-content: center;
                    cursor: zoom-out; }
        #lightbox.open { display: flex; }
        #lightbox img { max-width: 92vw; max-height: 92vh; object-fit: contain; border-radius: 4px;
                        cursor: default; box-shadow: 0 0 60px rgba(0,0,0,0.8); }
        #lightbox-close { position: fixed; top: 1.25rem; right: 1.5rem;
                          background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2);
                          color: #fff; border-radius: 6px; width: 36px; height: 36px;
                          font-size: 1.2rem; cursor: pointer; display: flex;
                          align-items: center; justify-content: center; }
        #lightbox-close:hover { background: rgba(255,255,255,0.22); }
    </style>
</head>
<body>
    <div id="toolbar">
        <div style="display:flex;align-items:center;gap:1rem;">
            <h1>${brandName} — Ad Selector</h1>
            <div id="progress">0 / ${totalGroups} selected</div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
            <span id="saved-msg">✓ selections.json saved</span>
            <button id="save-btn">Save Selections →</button>
        </div>
    </div>
    <div class="content">
    <p class="subtitle">Generated ${timestamp} via Gemini &middot; ${totalImages} images &middot; ${results.length} templates &middot; Click an image to select it. One pick per ratio group.</p>
`;

  for (const r of results) {
    const title = r.template_name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    html += `
    <div class="template-section" id="section-${r.folder}">
        <h2 class="template-header">#${String(r.template_number).padStart(2, "0")} ${title}
            <span>${r.images.length} images</span>
            <button class="exclude-btn" id="exclude-btn-${r.folder}" onclick="toggleExclude('${r.folder}')">Exclude</button>
            <span class="excluded-badge">EXCLUDED</span></h2>
`;

    for (const { ratio, folder: ratioFolder } of selectedRatios) {
      const ratioImages = r.images.filter((img) => img.ratioFolder === ratioFolder);
      if (ratioImages.length === 0) continue;

      const groupId = `${r.folder}-${ratioFolder}`;
      html += `        <div class="ratio-section">
            <div class="ratio-label">
                <span class="badge">${ratio}</span>
                <span class="pick-status" id="status-${groupId}">— none selected</span>
            </div>
            <div class="image-grid">
`;
      ratioImages.forEach((img, idx) => {
        const imgPath = `${r.folder}/${ratioFolder}/${img.filename}`;
        const cardId = `card-${r.folder}-${ratioFolder}-${idx}`;
        const isDefault = idx === 0;
        html += `                <div class="image-card${isDefault ? " selected" : ""}" id="${cardId}"
                     data-group="${groupId}" data-path="${imgPath}" data-filename="${img.filename}"
                     onclick="selectCard('${groupId}','${cardId}','${imgPath}','${img.filename}')">
                    <button class="expand-btn" onclick="event.stopPropagation(); openLightbox('${imgPath}')" title="View full size">⤢</button>
                    <div class="radio-dot"></div>
                    <img src="${imgPath}" alt="${r.template_name} ${ratio} v${idx + 1}" loading="lazy">
                    <div class="info"><span>${img.filename}</span><span>v${idx + 1}</span></div>
                </div>
`;
      });
      html += `            </div>
        </div>
`;
    }

    html += `    </div>
`;
  }

  html += `    </div>
    <div id="toast">✓ Selections saved — move selections.json into this output folder</div>
    <div id="lightbox" onclick="closeLightbox()">
        <button id="lightbox-close" onclick="closeLightbox()">✕</button>
        <img id="lightbox-img" src="" alt="" onclick="event.stopPropagation()">
    </div>
    <script>
        const selections = {};
        const excluded = new Set();
        const groupsPerTemplate = ${JSON.stringify(groupsPerTemplateObj)};

        document.querySelectorAll('.image-card.selected').forEach(c => {
            selections[c.dataset.group] = { path: c.dataset.path, filename: c.dataset.filename };
        });
        updateProgress();

        function templateFromGroupId(groupId) {
            for (const tmpl of Object.keys(groupsPerTemplate)) {
                if (groupId.startsWith(tmpl + '-')) return tmpl;
            }
            return groupId.slice(0, groupId.lastIndexOf('-'));
        }

        function selectCard(groupId, cardId, imgPath, filename) {
            document.querySelectorAll('.image-card[data-group="' + groupId + '"]').forEach(c => c.classList.remove('selected'));
            document.getElementById(cardId).classList.add('selected');
            selections[groupId] = { path: imgPath, filename };
            const st = document.getElementById('status-' + groupId);
            if (st) { st.textContent = '✓ ' + filename; st.classList.add('selected'); }
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
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

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
            const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'selections.json'; a.click();
            URL.revokeObjectURL(url);
            document.getElementById('saved-msg').style.display = 'block';
            const toast = document.getElementById('toast');
            toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000);
        });
    </script>
</body>
</html>
`;

  const galleryPath = join(outputDir, "gallery.html");
  writeFileSync(galleryPath, html, "utf-8");
  console.log(`\nGallery saved to: ${galleryPath}`);
  console.log(`  → Open in browser, pick your best images, click 'Save Selections →'`);
  console.log(`  → Move the downloaded selections.json into this folder`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      "brand-dir": { type: "string", default: "." },
      templates: { type: "string", default: "" },
      "num-images": { type: "string", default: String(DEFAULT_NUM_IMAGES) },
      "max-concurrent": { type: "string", default: "2" },
      ratios: { type: "string", default: "1x1,9x16" },
    },
  });

  const brandDir = resolve(values["brand-dir"]);
  const numImages = parseInt(values["num-images"], 10);

  if (!GEMINI_KEY) {
    console.error("Error: GEMINI_KEY not found.");
    console.error('Set it with:  export GEMINI_KEY="your-api-key"');
    console.error("Or add it to a .env file in the project root:  GEMINI_KEY=your-api-key");
    process.exit(1);
  }

  const promptsFile = join(brandDir, "prompts.json");
  if (!existsSync(promptsFile)) {
    console.error(`Error: ${promptsFile} not found. Run Phase 2 first to generate prompts.`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(promptsFile, "utf-8"));
  const brandName = data.brand || "Unknown Brand";
  let prompts = data.prompts || [];

  if (values.templates) {
    const templateNums = new Set(values.templates.split(",").map((x) => parseInt(x.trim(), 10)));
    prompts = prompts.filter((p) => templateNums.has(p.template_number));
    console.log(`Generating ${prompts.length} selected template(s) for ${brandName}`);
  } else {
    console.log(`Generating all ${prompts.length} templates for ${brandName}`);
  }

  if (prompts.length === 0) {
    console.error("No prompts to generate. Check your template numbers.");
    process.exit(1);
  }

  // Parse selected ratios
  const ratioKeys = new Set(values.ratios.split(",").map((r) => r.trim()));
  const selectedRatios = ASPECT_RATIOS.filter((ar) => ratioKeys.has(ar.folder));
  if (selectedRatios.length === 0) {
    console.error("No valid ratios selected. Use: --ratios 1x1,9x16");
    process.exit(1);
  }

  // Load product images as base64
  const imgDir = join(brandDir, "product-images");
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const allImageNames = existsSync(imgDir)
    ? readdirSync(imgDir).filter((f) => imageExtensions.has(extname(f).toLowerCase())).sort()
    : [];

  if (allImageNames.length === 0) {
    console.error("Error: No product images found in product-images/ folder.");
    process.exit(1);
  }

  console.log(`\nLoading ${allImageNames.length} reference images as base64...`);
  const refPartsMap = new Map();
  const allRefParts = [];

  for (const name of allImageNames) {
    const filePath = join(imgDir, name);
    const part = loadImageAsInlineData(filePath);
    refPartsMap.set(name, part);
    allRefParts.push(part);
    const sizeMB = (readFileSync(filePath).length / (1024 * 1024)).toFixed(1);
    console.log(`  ${name} (${sizeMB} MB)`);
  }

  // Date-versioned output directory
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}-${String(now.getDate()).padStart(2, "0")}-${String(now.getFullYear()).slice(2)}`;
  const outputsRoot = join(brandDir, "outputs");
  mkdirSync(outputsRoot, { recursive: true });

  let version = 1;
  if (existsSync(outputsRoot)) {
    const existing = readdirSync(outputsRoot).filter((d) => d.startsWith(`${dateStr}-V`));
    for (const d of existing) {
      const match = d.match(/-V(\d+)$/);
      if (match) version = Math.max(version, parseInt(match[1], 10) + 1);
    }
  }

  const outputDir = join(outputsRoot, `${dateStr}-V${version}`);
  mkdirSync(outputDir, { recursive: true });

  const maxConcurrent = parseInt(values["max-concurrent"] || "2", 10);
  const totalJobs = prompts.length * selectedRatios.length;
  const totalImages = totalJobs * numImages;

  const sep = "=".repeat(55);
  console.log(`\n${sep}`);
  console.log(`  Brand:       ${brandName}`);
  console.log(`  Model:       ${GEMINI_MODEL}`);
  console.log(`  Templates:   ${prompts.length}`);
  console.log(`  Refs:        ${refPartsMap.size} images (sent as base64)`);
  console.log(`  Ratios:      ${selectedRatios.map((r) => r.ratio).join(" + ")}`);
  console.log(`  Images/each: ${numImages} per ratio`);
  console.log(`  Total imgs:  ${totalImages}`);
  console.log(`  Concurrent:  ${maxConcurrent}`);
  console.log(`  Output:      ${outputDir}`);
  console.log(sep);

  const { results, failed } = await generateAllParallel(prompts, refPartsMap, allRefParts, outputDir, numImages, maxConcurrent, selectedRatios);

  if (results.length > 0) {
    generateGallery(outputDir, results, brandName, selectedRatios);
  }

  const totalGenerated = results.reduce((sum, r) => sum + r.images.length, 0);
  console.log(`\n${sep}`);
  console.log(`  DONE!`);
  console.log(`  Generated: ${totalGenerated} images across ${results.length} templates`);
  if (failed.length > 0) {
    console.log(`  Failed:    ${failed.length} job(s)`);
    for (const f of failed) {
      console.log(`    - Template #${f.num}: ${f.error.slice(0, 80)}`);
    }
  }
  console.log(`  Output:    ${outputDir}`);
  console.log(`  Gallery:   ${join(outputDir, "gallery.html")}`);
  console.log(sep);
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
