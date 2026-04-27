/**
 * Enriches the LEGO catalog with AI-generated descriptions using Gemini Vision.
 * Sends each part image to Gemini and gets a rich text description.
 * 
 * Usage: GEMINI_API_KEY=your_key node scripts/enrich-catalog.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const IMAGES_DIR = join(DATA_DIR, 'images');

const CATEGORY_DIRS = {
  BAM_HEAD: 'heads',
  BAM_HEADWEAR: 'headwear',
  BAM_TORSO: 'torsos',
  BAM_LEG: 'legs',
  BAM_ACC: 'accessories',
};

const CATEGORY_PROMPTS = {
  BAM_HEAD: `Describe this LEGO minifigure head in 1-2 concise sentences. Focus on:
- Skin tone (yellow, light nougat, medium nougat, dark brown, etc.)
- Expression (smile, grin, frown, angry, scared, wink, etc.)
- Facial features (glasses, sunglasses, beard, mustache, freckles, scars, makeup, etc.)
- If it has a dual face (different expression on each side), describe both.
Be factual and precise. This description will be used for matching against real people's faces.`,

  BAM_HEADWEAR: `Describe this LEGO minifigure headwear/hair piece in 1-2 concise sentences. Focus on:
- Type: hair, hat, helmet, hood, cap, crown, headband, etc.
- Color (be specific: dark brown, bright red, medium nougat, sand blue, etc.)
- Style: for hair - short, long, curly, straight, ponytail, bun, mohawk, bald, etc.
         for hats - baseball cap, top hat, cowboy hat, beanie, crown, etc.
- Any special features (flowers, accessories attached, etc.)
Be factual and precise.`,

  BAM_TORSO: `Describe this LEGO minifigure torso (upper body) in 1-2 concise sentences. Focus on:
- Primary colors and pattern
- Type of outfit/clothing (t-shirt, suit, uniform, dress, armor, etc.)
- Any prints/details (stripes, logos, buttons, tie, necklace, etc.)
- Theme/character type (casual, formal, sporty, medieval, sci-fi, etc.)
Be factual and precise.`,

  BAM_LEG: `Describe this LEGO minifigure leg piece in 1 concise sentence. Focus on:
- Type: regular legs, short legs, skirt, dress bottom
- Color(s)
- Any printed details (belt, shoes, pattern, etc.)
Be factual and precise.`,

  BAM_ACC: `Describe this LEGO minifigure accessory in 1 concise sentence. Focus on:
- What the object is (sword, shield, cup, tool, animal, food, instrument, etc.)
- Color
- Any distinguishing features
Be factual and precise.`,
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ Please set GEMINI_API_KEY environment variable');
    console.error('   Usage: GEMINI_API_KEY=your_key node scripts/enrich-catalog.mjs');
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  // Load catalog
  const catalog = JSON.parse(readFileSync(join(DATA_DIR, 'catalog.json'), 'utf-8'));

  // Load existing enriched data if it exists (to resume)
  const enrichedPath = join(DATA_DIR, 'catalog-enriched.json');
  let enrichedData = {};
  if (existsSync(enrichedPath)) {
    enrichedData = JSON.parse(readFileSync(enrichedPath, 'utf-8'));
    console.log('📂 Loaded existing enriched data, will resume from where we left off\n');
  }

  const stats = { total: 0, enriched: 0, skipped: 0, failed: 0 };

  for (const [category, dirName] of Object.entries(CATEGORY_DIRS)) {
    const parts = catalog.catalog[category];
    if (!parts) continue;

    if (!enrichedData[category]) enrichedData[category] = {};

    console.log(`\n📦 ${category} (${parts.length} parts)`);
    const prompt = CATEGORY_PROMPTS[category];

    // Process in small batches to respect rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const batch = parts.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async (part) => {
        stats.total++;

        // Skip if already enriched
        if (enrichedData[category][part.id]) {
          stats.skipped++;
          return;
        }

        const imagePath = join(IMAGES_DIR, dirName, `${part.id}.webp`);
        if (!existsSync(imagePath)) {
          stats.failed++;
          console.log(`  ⚠️  No image for ${part.id}`);
          return;
        }

        try {
          const imageData = readFileSync(imagePath);
          const base64 = imageData.toString('base64');

          const result = await model.generateContent([
            prompt,
            {
              inlineData: {
                mimeType: 'image/webp',
                data: base64,
              },
            },
          ]);

          const description = result.response.text().trim();
          enrichedData[category][part.id] = {
            ...part,
            description,
          };
          stats.enriched++;
        } catch (error) {
          stats.failed++;
          console.log(`  ❌ Failed ${part.id}: ${error.message}`);

          // If rate limited, wait and retry
          if (error.message?.includes('429') || error.message?.includes('quota')) {
            console.log('  ⏳ Rate limited, waiting 30s...');
            await new Promise(r => setTimeout(r, 30000));
          }
        }
      });

      await Promise.all(promises);

      // Save progress every batch
      writeFileSync(enrichedPath, JSON.stringify(enrichedData, null, 2));

      const done = Math.min(i + BATCH_SIZE, parts.length);
      process.stdout.write(`  Progress: ${done}/${parts.length} (enriched: ${stats.enriched}, skipped: ${stats.skipped})\r`);

      // Small delay between batches to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`\n  ✅ Done`);
  }

  // Build final enriched catalog for the web app
  const finalCatalog = {};
  for (const [category, dirName] of Object.entries(CATEGORY_DIRS)) {
    const parts = catalog.catalog[category];
    finalCatalog[category] = parts.map(part => ({
      id: part.id,
      designId: part.designId,
      name: part.name,
      description: enrichedData[category]?.[part.id]?.description || part.name,
      price: part.price,
    }));
  }

  writeFileSync(
    join(DATA_DIR, 'catalog-final.json'),
    JSON.stringify({
      enrichedAt: new Date().toISOString(),
      summary: catalog.summary,
      categories: catalog.categories,
      catalog: finalCatalog,
    }, null, 2)
  );

  console.log(`\n\n=== ENRICHMENT SUMMARY ===`);
  console.log(`  Total: ${stats.total}`);
  console.log(`  Enriched: ${stats.enriched}`);
  console.log(`  Skipped (exists): ${stats.skipped}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`\n💾 Enriched catalog saved to ${enrichedPath}`);
  console.log(`💾 Final catalog saved to ${join(DATA_DIR, 'catalog-final.json')}`);
}

main().catch(console.error);
