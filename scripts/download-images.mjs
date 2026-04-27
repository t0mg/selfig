/**
 * Downloads all LEGO minifigure part images from the CDN.
 * Saves them locally for Gemini enrichment and as static assets.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const IMAGES_DIR = join(DATA_DIR, 'images');

// LEGO CDN URLs
const THUMBNAIL_URL = (id) => `https://www.lego.com/cdn/mff/optimised/thumbnails/${id}_0.webp`;
const DISPLAY_URL = (id) => `https://www.lego.com/cdn/mff/optimised/display/${id}_0.webp`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.lego.com/fr-fr/pick-and-build/create-a-minifigure',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
};

const CATEGORY_DIRS = {
  BAM_HEAD: 'heads',
  BAM_HEADWEAR: 'headwear',
  BAM_TORSO: 'torsos',
  BAM_LEG: 'legs',
  BAM_ACC: 'accessories',
};

async function downloadImage(url, outputPath, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) {
        if (attempt === retries - 1) {
          return { success: false, status: response.status };
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(outputPath, buffer);
      return { success: true, size: buffer.length };
    } catch (error) {
      if (attempt === retries - 1) {
        return { success: false, error: error.message };
      }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function main() {
  // Load catalog
  const catalog = JSON.parse(readFileSync(join(DATA_DIR, 'catalog.json'), 'utf-8'));
  
  console.log('📸 Downloading LEGO minifigure part images...\n');

  const stats = { total: 0, success: 0, failed: 0, skipped: 0 };

  for (const [category, dirName] of Object.entries(CATEGORY_DIRS)) {
    const parts = catalog.catalog[category];
    if (!parts) {
      console.log(`⚠️  No parts found for ${category}`);
      continue;
    }

    const categoryDir = join(IMAGES_DIR, dirName);
    mkdirSync(categoryDir, { recursive: true });

    console.log(`\n📦 ${category} (${parts.length} parts) → ${dirName}/`);

    // Process in batches of 10 concurrent downloads
    const BATCH_SIZE = 10;
    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (part) => {
        stats.total++;
        const outputPath = join(categoryDir, `${part.id}.webp`);

        // Skip if already downloaded
        if (existsSync(outputPath)) {
          stats.skipped++;
          return;
        }

        // Try display URL first (higher quality), fallback to thumbnail
        let result = await downloadImage(DISPLAY_URL(part.id), outputPath);
        if (!result.success) {
          result = await downloadImage(THUMBNAIL_URL(part.id), outputPath);
        }

        if (result.success) {
          stats.success++;
        } else {
          stats.failed++;
          console.log(`  ❌ Failed: ${part.id} (${part.name}) - ${result.status || result.error}`);
        }
      });

      await Promise.all(promises);

      // Progress
      const done = Math.min(i + BATCH_SIZE, parts.length);
      process.stdout.write(`  Progress: ${done}/${parts.length}\r`);
    }
    console.log(`  ✅ Done`);
  }

  console.log(`\n\n=== DOWNLOAD SUMMARY ===`);
  console.log(`  Total: ${stats.total}`);
  console.log(`  Downloaded: ${stats.success}`);
  console.log(`  Skipped (exists): ${stats.skipped}`);
  console.log(`  Failed: ${stats.failed}`);
}

main().catch(console.error);
