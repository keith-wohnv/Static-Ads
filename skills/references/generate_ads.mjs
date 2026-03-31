#!/usr/bin/env node
/**
 * Static Ad Generator - FAL API Integration
 * Generates static ad images using Nano Banana 2 (text-to-image) via FAL API.
 *
 * Usage:
 *   node generate_ads.mjs --brand-dir brands/{name}        # Full run (all templates, 4 imgs, 2K)
 *   node generate_ads.mjs --brand-dir brands/{name} --templates 1,7,13 --num-images 1 --resolution 1K  # Cheap test
 *   node generate_ads.mjs --brand-dir brands/{name} --max-concurrent 20  # Match your FAL limit
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, createWriteStream } from "fs";
import { join, extname, resolve, dirname } from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const QUEUE_URL = "https://queue.fal.run";
const MODEL_ID = "fal-ai/nano-banana-2/edit";

const DEFAULT_NUM_IMAGES = 4;
const DEFAULT_RESOLUTION = "2K";
const DEFAULT_OUTPUT_FORMAT = "png";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes max wait per request
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;

/**
 * Load FAL_KEY from environment or .env file
 */
function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;

  const envPaths = [
    resolve(__dirname, "..", "..", ".env"),
    resolve(process.cwd(), ".env"),
  ];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("FAL_KEY=")) {
          return trimmed.slice("FAL_KEY=".length).trim().replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  return "";
}

const FAL_KEY = loadFalKey();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeaders() {
  return {
    Authorization: `Key ${FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// FAL CDN Upload
// ---------------------------------------------------------------------------

/**
 * Upload a local file to FAL CDN. Returns a persistent CDN URL.
 */
async function uploadToFalCdn(filePath, uniqueSuffix = "") {
  const baseName = filePath.split(/[\\/]/).pop();
  const ext = extname(filePath).toLowerCase();
  // Add unique suffix to filename so FAL CDN returns a distinct URL every time
  const nameWithoutExt = baseName.slice(0, -ext.length);
  const fileName = uniqueSuffix ? `${nameWithoutExt}_${uniqueSuffix}${ext}` : baseName;
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  const initRes = await fetch(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ file_name: fileName, content_type: contentType }),
    },
  );
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`CDN upload initiate failed (${initRes.status}): ${text}`);
  }
  const { upload_url, file_url } = await initRes.json();

  const fileData = readFileSync(filePath);
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: fileData,
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`CDN upload PUT failed (${putRes.status}): ${text}`);
  }

  // Poll until the CDN URL is actually accessible before returning
  for (let i = 0; i < 10; i++) {
    const headRes = await fetch(file_url, { method: "HEAD" });
    if (headRes.ok) return file_url;
    await sleep(1000);
  }

  // Final attempt — if still failing, throw
  const finalCheck = await fetch(file_url, { method: "HEAD" });
  if (!finalCheck.ok) {
    throw new Error(`CDN file not available after 10s: ${file_url} (${finalCheck.status})`);
  }
  return file_url;
}

/**
 * Upload all images in product-images/ to FAL CDN.
 * Returns a Map of filename → CDN URL.
 */
async function uploadProductImages(brandDir) {
  const imgDir = join(brandDir, "product-images");
  if (!existsSync(imgDir)) {
    console.log("  No product-images/ folder found — skipping reference uploads");
    return new Map();
  }

  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const urlMap = new Map();
  // Unique run ID ensures FAL CDN returns fresh URLs every run
  const runId = `run_${Date.now()}`;

  for (const name of readdirSync(imgDir).sort()) {
    if (!imageExtensions.has(extname(name).toLowerCase())) continue;
    const filePath = join(imgDir, name);
    console.log(`  Uploading ${name}...`);
    const url = await uploadToFalCdn(filePath, runId);
    urlMap.set(name, url);
  }

  console.log(`  ${urlMap.size} image(s) uploaded to FAL CDN`);
  return urlMap;
}

// ---------------------------------------------------------------------------
// FAL API
// ---------------------------------------------------------------------------

async function submitRequest(payload) {
  const url = `${QUEUE_URL}/${MODEL_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function pollUntilComplete(statusUrl, label = "") {
  const headers = { Authorization: `Key ${FAL_KEY}` };

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await fetch(`${statusUrl}?logs=1`, { headers });
    const data = await res.json();
    const status = data.status || "UNKNOWN";

    if (status === "COMPLETED") {
      return data;
    } else if (status === "IN_QUEUE") {
      const pos = data.queue_position ?? "?";
      process.stdout.write(`    ${label} — queued (pos ${pos})      \r`);
    } else if (status === "IN_PROGRESS") {
      process.stdout.write(`    ${label} — generating...            \r`);
    } else {
      const errorMsg = data.error || "Unknown error";
      throw new Error(`Generation failed for '${label}': ${errorMsg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timeout waiting for '${label}' after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function getResult(responseUrl) {
  const headers = { Authorization: `Key ${FAL_KEY}` };
  const res = await fetch(responseUrl, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get result failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function downloadImage(url, savePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const fileStream = createWriteStream(savePath);
  await pipeline(res.body, fileStream);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const ASPECT_RATIOS = [
  { ratio: "1:1", folder: "1x1" },
  { ratio: "9:16", folder: "9x16" },
];

/**
 * Run a single job: submit, poll, download for one template + one ratio.
 * Uses pre-uploaded CDN URLs passed in from main to avoid excessive CDN operations.
 */
async function runJob(promptData, cdnUrlMap, allImageNames, outputDir, numImages, resolution, ratio, ratioFolder) {
  const templateNum = promptData.template_number;
  const templateName = promptData.template_name;
  const label = `[${String(templateNum).padStart(2, "0")}] ${templateName} ${ratio}`;

  const folderName = `${String(templateNum).padStart(2, "0")}-${templateName}`;
  const templateDir = join(outputDir, folderName);
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, "prompt.txt"), promptData.prompt, "utf-8");

  const ratioDir = join(templateDir, ratioFolder);
  mkdirSync(ratioDir, { recursive: true });

  // Determine which reference images this job needs
  const refImages = (promptData.reference_images || []).length > 0
    ? promptData.reference_images
    : allImageNames;

  // Use pre-uploaded CDN URLs
  const imageUrls = [];
  for (const name of refImages.slice(0, 14)) {
    const url = cdnUrlMap.get(name);
    if (url) {
      imageUrls.push(url);
    } else {
      console.warn(`    WARNING: ${name} not in CDN map`);
    }
  }

  if (imageUrls.length === 0) {
    throw new Error(`No reference images available for ${label}`);
  }

  // Always use /edit endpoint — image_urls required for brand accuracy
  const payload = {
    prompt: promptData.prompt,
    image_urls: imageUrls,
    num_images: numImages,
    aspect_ratio: ratio,
    output_format: DEFAULT_OUTPUT_FORMAT,
    resolution,
    safety_tolerance: 6,
  };

  console.log(`  ${label} (${imageUrls.length} refs) — submitting...`);

  // Retry loop — /edit endpoint can reject intermittently with 422
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const submitData = await submitRequest(payload);
      const requestId = submitData.request_id;
      const statusUrl = submitData.status_url || `${QUEUE_URL}/${MODEL_ID}/requests/${requestId}/status`;
      const responseUrl = submitData.response_url || `${QUEUE_URL}/${MODEL_ID}/requests/${requestId}/response`;

      console.log(`  ${label} — queued (${requestId})`);

      await pollUntilComplete(statusUrl, label);

      const result = await getResult(responseUrl);
      const images = result.images || [];
      console.log(`  ${label} — got ${images.length} image(s), downloading...`);

      const downloaded = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const contentType = img.content_type || "image/png";
        const ext = contentType.includes("/") ? contentType.split("/")[1] : "png";
        const filename = `${templateName}_${ratioFolder}_v${i + 1}.${ext}`;
        const savePath = join(ratioDir, filename);
        await downloadImage(img.url, savePath);
        downloaded.push({ filename, ratioFolder, ratio, url: img.url, width: img.width || null, height: img.height || null });
      }

      console.log(`  ${label} — DONE (${downloaded.length} saved)`);
      return { templateNum, templateName, folderName, downloaded };
    } catch (err) {
      const isRetryable = err.message.includes("422") || err.message.includes("Could not generate");
      if (isRetryable && attempt < MAX_RETRIES) {
        console.warn(`  ${label} — failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Generate all templates + ratios in parallel, up to maxConcurrent simultaneous API calls.
 * Staggers job submissions with a delay to avoid overwhelming FAL's CDN/API.
 */
async function generateAllParallel(prompts, cdnUrlMap, allImageNames, outputDir, numImages, resolution, maxConcurrent) {
  // Build flat list of all jobs (template × ratio)
  const jobs = [];
  for (const promptData of prompts) {
    for (const { ratio, folder: ratioFolder } of ASPECT_RATIOS) {
      jobs.push({ promptData, ratio, ratioFolder });
    }
  }

  console.log(`\nDispatching ${jobs.length} jobs (max ${maxConcurrent} concurrent, 2s stagger)...\n`);

  // Semaphore-based concurrency limiter with staggered launches
  let active = 0;
  let idx = 0;
  const jobResults = new Array(jobs.length);
  const JOB_STAGGER_MS = 2000; // 2s between job submissions to avoid CDN rate limits

  await new Promise((resolveAll) => {
    let settled = 0;

    async function launchNext() {
      while (active < maxConcurrent && idx < jobs.length) {
        const jobIdx = idx++;
        const job = jobs[jobIdx];
        active++;

        // Stagger submissions to avoid overwhelming FAL
        if (jobIdx > 0) await sleep(JOB_STAGGER_MS);

        runJob(job.promptData, cdnUrlMap, allImageNames, outputDir, numImages, resolution, job.ratio, job.ratioFolder)
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
    if (!templateMap.has(templateNum)) {
      templateMap.set(templateNum, { template_number: templateNum, template_name: templateName, folder: folderName, images: [] });
    }
    templateMap.get(templateNum).images.push(...downloaded);
  }

  const results = [...templateMap.values()].sort((a, b) => a.template_number - b.template_number);
  return { results, failed };
}

// ---------------------------------------------------------------------------
// HTML Gallery
// ---------------------------------------------------------------------------

function generateGallery(outputDir, results, brandName) {
  const totalImages = results.reduce((sum, r) => sum + r.images.length, 0);
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${brandName} - Static Ad Gallery</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0a0a0a; color: #fff; padding: 2rem; }
        h1 { text-align: center; margin-bottom: 0.5rem; font-size: 2rem; }
        .subtitle { text-align: center; color: #888; margin-bottom: 2rem; }
        .template-section { margin-bottom: 3rem; }
        .template-header { font-size: 1.3rem; margin-bottom: 1rem; padding-bottom: 0.5rem;
                           border-bottom: 1px solid #333; }
        .template-header span { color: #888; font-weight: normal; font-size: 0.9rem; }
        .ratio-section { margin-bottom: 1.5rem; }
        .ratio-label { font-size: 1rem; color: #ccc; margin-bottom: 0.75rem; padding-left: 0.25rem;
                       font-weight: 600; }
        .ratio-label .badge { display: inline-block; background: #333; color: #fff; padding: 0.15rem 0.5rem;
                              border-radius: 4px; font-size: 0.8rem; font-weight: 500; margin-left: 0.25rem; }
        .image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                      gap: 1rem; }
        .image-card { background: #1a1a1a; border-radius: 8px; overflow: hidden; }
        .image-card img { width: 100%; height: auto; display: block; cursor: pointer;
                          transition: transform 0.2s; }
        .image-card img:hover { transform: scale(1.02); }
        .image-card .info { padding: 0.75rem; font-size: 0.85rem; color: #aaa; }
    </style>
</head>
<body>
    <h1>${brandName} Static Ad Gallery</h1>
    <p class="subtitle">Generated ${timestamp} &middot; ${totalImages} images across ${results.length} templates (1:1 + 9:16)</p>
`;

  for (const r of results) {
    const title = r.template_name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    html += `
    <div class="template-section">
        <h2 class="template-header">#${String(r.template_number).padStart(2, "0")} ${title}
            <span>(${r.images.length} total)</span></h2>
`;

    for (const { ratio, folder: ratioFolder } of ASPECT_RATIOS) {
      const ratioImages = r.images.filter((img) => img.ratioFolder === ratioFolder);
      if (ratioImages.length === 0) continue;

      html += `        <div class="ratio-section">
            <div class="ratio-label"><span class="badge">${ratio}</span></div>
            <div class="image-grid">
`;
      for (const img of ratioImages) {
        const dims = img.width ? ` | ${img.width}x${img.height}` : "";
        html += `                <div class="image-card">
                    <a href="${r.folder}/${ratioFolder}/${img.filename}" target="_blank">
                        <img src="${r.folder}/${ratioFolder}/${img.filename}" alt="${r.template_name} ${ratio}">
                    </a>
                    <div class="info">${img.filename}${dims}</div>
                </div>
`;
      }
      html += `            </div>
        </div>
`;
    }

    html += `    </div>
`;
  }

  html += `</body>
</html>
`;

  const galleryPath = join(outputDir, "gallery.html");
  writeFileSync(galleryPath, html, "utf-8");
  console.log(`\nGallery saved to: ${galleryPath}`);
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
      resolution: { type: "string", default: DEFAULT_RESOLUTION },
      "max-concurrent": { type: "string", default: "2" },
    },
  });

  const brandDir = resolve(values["brand-dir"]);
  const numImages = parseInt(values["num-images"], 10);
  const resolution = values.resolution;

  if (!FAL_KEY) {
    console.error("Error: FAL_KEY not found.");
    console.error('Set it with:  export FAL_KEY="your-api-key"');
    console.error("Or add it to a .env file in the project root:  FAL_KEY=your-api-key");
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

  const costPerImage = { "0.5K": 0.06, "1K": 0.08, "2K": 0.12, "4K": 0.16 };
  const estCost = prompts.length * numImages * ASPECT_RATIOS.length * (costPerImage[resolution] || 0.08);

  // Validate product images exist (uploads happen per-job now to avoid CDN rate-limiting)
  const imgDir = join(brandDir, "product-images");
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const allImageNames = existsSync(imgDir)
    ? readdirSync(imgDir).filter((f) => imageExtensions.has(extname(f).toLowerCase())).sort()
    : [];

  if (allImageNames.length === 0) {
    console.error("Error: No product images found in product-images/ folder.");
    console.error("The /edit endpoint requires reference images for brand accuracy.");
    console.error(`Add product images to: ${imgDir}/`);
    process.exit(1);
  }

  // Upload all product images to CDN once at startup
  console.log(`\nUploading ${allImageNames.length} reference images to FAL CDN...`);
  const cdnUrlMap = await uploadProductImages(brandDir);

  if (cdnUrlMap.size === 0) {
    console.error("Error: Failed to upload any product images to CDN.");
    process.exit(1);
  }

  console.log(`Uploaded ${cdnUrlMap.size} images — CDN URLs will be reused across all jobs`);

  // Date-versioned output directory: outputs/M-DD-YY-V1, V2, V3...
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}-${String(now.getDate()).padStart(2, "0")}-${String(now.getFullYear()).slice(2)}`;
  const outputsRoot = join(brandDir, "outputs");
  mkdirSync(outputsRoot, { recursive: true });

  // Find next version number for today
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

  const sep = "=".repeat(55);
  console.log(`\n${sep}`);
  console.log(`  Brand:       ${brandName}`);
  console.log(`  Model:       ${MODEL_ID}`);
  console.log(`  Templates:   ${prompts.length}`);
  console.log(`  Refs:        ${cdnUrlMap.size} images (uploaded once, reused)`);
  console.log(`  Ratios:      1:1 + 9:16 (both per template)`);
  console.log(`  Images/each: ${numImages} per ratio`);
  console.log(`  Resolution:  ${resolution}`);
  console.log(`  Concurrent:  ${maxConcurrent}`);
  console.log(`  Est. cost:   ~$${estCost.toFixed(2)}`);
  console.log(`  Output:      ${outputDir}`);
  console.log(sep);

  const { results, failed } = await generateAllParallel(prompts, cdnUrlMap, allImageNames, outputDir, numImages, resolution, maxConcurrent);

  if (results.length > 0) {
    generateGallery(outputDir, results, brandName);
  }

  const totalImages = results.reduce((sum, r) => sum + r.images.length, 0);
  console.log(`\n${sep}`);
  console.log(`  DONE!`);
  console.log(`  Generated: ${totalImages} images across ${results.length} templates`);
  if (failed.length > 0) {
    console.log(`  Failed:    ${failed.length} template(s)`);
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
