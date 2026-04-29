/**
 * Matcher module — uses Gemini to analyze a photo and select the best LEGO parts.
 * 
 * Strategy:
 * The catalog has ~1,125 parts but part names are generic ("MINI HEAD NO. 3377").
 * If we have pre-enriched descriptions, we use those. Otherwise we send a subset
 * of part images directly to Gemini alongside the user photo.
 * 
 * We use two LLM calls:
 *   1. describePhoto — sends the image, returns a text description
 *   2. matchAllCategories — sends the text description + full catalog, returns all picks
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const IMG_URL = (id) => `https://www.lego.com/cdn/mff/optimised/thumbnails/${id}_0.webp`;

const CATEGORY_ORDER = [
  { key: 'BAM_HEAD', label: 'Head', emoji: '😊' },
  { key: 'BAM_HEADWEAR', label: 'Headwear / Hair', emoji: '💇' },
  { key: 'BAM_TORSO', label: 'Torso', emoji: '👕' },
  { key: 'BAM_LEG', label: 'Legs', emoji: '👖' },
  { key: 'BAM_ACC', label: 'Accessory 1', emoji: '⚔️' },
  { key: 'BAM_ACC_2', label: 'Accessory 2', emoji: '🛡️' },
];

export class Matcher {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
    this.catalog = null;
    this.hasDescriptions = false;
  }

  async loadCatalog() {
    const base = import.meta.env.BASE_URL;

    // Try to load enriched catalog first
    try {
      const res = await fetch(`${base}data/catalog-final.json`);
      if (res.ok) {
        const data = await res.json();
        this.catalog = data.catalog;
        // Check if descriptions are meaningful (not just the name repeated)
        const samplePart = Object.values(this.catalog)[0]?.[0];
        this.hasDescriptions = samplePart?.description && samplePart.description !== samplePart.name;
        console.log('Loaded enriched catalog, has descriptions:', this.hasDescriptions);
        return;
      }
    } catch (e) {
      console.log('No enriched catalog, trying raw catalog');
    }

    // Fallback to raw catalog
    const res = await fetch(`${base}data/catalog.json`);
    const data = await res.json();
    this.catalog = data.catalog;
    this.hasDescriptions = false;
    console.log('Loaded raw catalog');
  }

  /**
   * Main matching function — takes a user photo and returns the best matching parts.
   * Uses only 2 LLM calls: one vision call to describe the photo, one text call
   * to pick the best part from every category at once.
   * @param {File} photoFile - The user's uploaded photo
   * @param {function} onProgress - Progress callback (step, message)
   * @returns {Promise<{parts: Array, personDescription: string}>}
   */
  async match(photoFile, onProgress = () => { }) {
    if (!this.catalog) await this.loadCatalog();

    // Convert photo to base64 (resized + JPEG-encoded)
    const photoBase64 = await this.fileToBase64(photoFile);

    onProgress(10, 'Analyzing your photo...');

    // Call 1: describe the person in the photo (vision call)
    const personDescription = await this.describePhoto(photoBase64);
    onProgress(40, 'Photo analyzed! Matching all parts...');

    // Call 2: pick best part for every category in one shot (text-only call)
    const results = await this.matchAllCategories(personDescription);
    onProgress(90, 'Assembling your minifigure...');

    onProgress(100, 'Done!');

    return { parts: results, personDescription };
  }


  async describePhoto(photoBase64) {
    const result = await this.model.generateContent([
      `Describe this person in detail for the purpose of creating a matching LEGO minifigure. Ignore skin tone as the only color available is yellow anyway. Focus on:
1. Hair: color, style, length (or bald/hat)
2. Face: perceived age and gender, expression, glasses, facial hair, any distinctive features
3. Torso: what they're wearing. Describe the dominant color (provide the hex code for the color), then the style and details.
4. Legs: what they're wearing. Describe the dominant color (provide the hex code for the color), then the style and details.
5. Accessories: anything they're holding or wearing (jewelry, backpack, etc.)

Be detailed and factual. This description will be used to select LEGO minifigure parts.`,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: photoBase64,
        },
      },
    ]);

    return result.response.text().trim();
  }

  /**
   * Single LLM call that picks the best part for every category.
   * Text-only — no image tokens needed since we already have the description.
   */
  async matchAllCategories(personDescription) {
    // Build one combined catalog listing grouped by category
    const categoryLabels = {
      BAM_HEAD: 'HEAD (face)',
      BAM_HEADWEAR: 'HEADWEAR / HAIR',
      BAM_TORSO: 'TORSO (upper body / outfit)',
      BAM_LEG: 'LEGS (lower body)',
      BAM_ACC: 'ACCESSORIES',
    };

    const sections = [];
    for (const [catKey, label] of Object.entries(categoryLabels)) {
      const parts = this.catalog[catKey];
      if (!parts || parts.length === 0) continue;
      const list = parts.map(p => {
        const desc = this.hasDescriptions && p.description ? `${p.name} - ${p.description}` : p.name;
        return `  [${p.id}] ${desc}`;
      }).join('\n');
      sections.push(`── ${label} ──\n${list}`);
    }

    const prompt = `You are helping create a LEGO minifigure that looks like a real person.

PERSON DESCRIPTION:
${personDescription}

AVAILABLE PARTS BY CATEGORY:
${sections.join('\n\n')}

Select 1 to 3 best matching parts for each body category (head, headwear, torso, legs) and UP TO TWO accessories (with 0 to 3 alternatives each) that suit this person. Order your selections from best match to 3rd best. Consider expression, hair color/style, outfit, personality, etc.

CRITICAL RULES:
1. Accessories are OPTIONAL. We should not force any accessories if there is no strong match with the reference.
2. Do not include any weapon accessory (including firearms, knives, swords, spears, bows, etc) UNLESS the reference clearly mentions the person is holding a weapon.
3. If the reference describes a bald person, it is ok to omit the headwear (wig/hat). Genrally try to match hair length especially when the reference has long hair.
4. Respect the color tone for legs and torso. For example, absolutely avoid bright pink elements when the reference is a muted beige.
5. For legs, avoid "MINI LEG" type parts unless the reference describes a child.
6. For torso, avoid torso parts with distinctive details unless it is matching the reference.

If you choose to omit an optional part (headwear or accessories), return an empty array or an array containing null for its "partIds".`;

    try {
      const partSchema = {
        type: SchemaType.OBJECT,
        properties: {
          partIds: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING, nullable: true },
            nullable: true
          },
          reason: { type: SchemaType.STRING }
        },
        required: ["reason"]
      };

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          head: partSchema,
          headwear: partSchema,
          torso: partSchema,
          legs: partSchema,
          accessory1: partSchema,
          accessory2: partSchema
        },
        required: ["head", "headwear", "torso", "legs", "accessory1", "accessory2"]
      };

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
        }
      });
      const text = result.response.text().trim();
      const parsed = this.parseJSON(text);

      // Map response keys to category keys
      const keyMap = [
        { responseKey: 'head', catKey: 'BAM_HEAD', catIndex: 0 },
        { responseKey: 'headwear', catKey: 'BAM_HEADWEAR', catIndex: 1 },
        { responseKey: 'torso', catKey: 'BAM_TORSO', catIndex: 2 },
        { responseKey: 'legs', catKey: 'BAM_LEG', catIndex: 3 },
        { responseKey: 'accessory1', catKey: 'BAM_ACC', catIndex: 4 },
        { responseKey: 'accessory2', catKey: 'BAM_ACC', catIndex: 5 },
      ];

      return keyMap.map(({ responseKey, catKey, catIndex }) => {
        const pick = parsed[responseKey];

        const nullOption = {
          partId: null,
          partName: 'None',
          description: 'No part selected',
          reason: pick?.reason || 'Intentionally omitted',
          price: null,
          imageUrl: null,
          category: CATEGORY_ORDER[catIndex],
        };

        let options = [];
        const parts = this.catalog[catKey] || [];

        if (pick && pick.partIds && Array.isArray(pick.partIds)) {
          options = pick.partIds.map(id => {
            if (id === null || id === 'null') return nullOption;
            const part = parts.find(p => p.id === id);
            if (part) {
              return {
                partId: part.id,
                designId: part.designId,
                partName: part.name,
                description: part.description || part.name,
                reason: pick.reason || 'Best match',
                price: part.price,
                imageUrl: IMG_URL(part.id),
                category: CATEGORY_ORDER[catIndex],
              };
            }
            return null;
          }).filter(Boolean);
        }

        if (options.length === 0) {
          if (catKey === 'BAM_ACC' || catKey === 'BAM_HEADWEAR') {
            options = [{ ...nullOption, reason: 'Invalid part ID selected by AI or explicitly omitted' }];
          } else {
            const fallback = parts[catIndex === 5 ? 1 : 0] || parts[0];
            if (fallback) {
              options = [{
                partId: fallback.id,
                designId: fallback.designId,
                partName: fallback.name,
                description: fallback.description || fallback.name,
                reason: 'Default selection (matching failed)',
                price: fallback.price,
                imageUrl: IMG_URL(fallback.id),
                category: CATEGORY_ORDER[catIndex],
              }];
            } else {
              options = [{ ...nullOption, reason: 'No parts available in catalog' }];
            }
          }
        }

        return {
          ...options[0],
          options,
          currentIndex: 0
        };
      });
    } catch (error) {
      console.error('Batch matching failed:', error);

      // Full fallback — return first part from each category
      return CATEGORY_ORDER.map((cat, i) => {
        const catKey = i < 4 ? cat.key : 'BAM_ACC';
        const parts = this.catalog[catKey] || [];
        const p = parts[i === 5 ? 1 : 0] || parts[0];

        const nullOption = { partId: null, partName: 'Unknown', reason: 'No parts', category: cat };
        let options = p ? [{
          partId: p.id, designId: p.designId, partName: p.name,
          description: p.description || p.name, reason: 'Default selection',
          price: p.price, imageUrl: IMG_URL(p.id), category: cat,
        }] : [nullOption];

        return { ...options[0], options, currentIndex: 0 };
      });
    }
  }

  parseJSON(text) {
    // Remove markdown code blocks if present
    const cleaned = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Try to find JSON object in the text
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error('Could not parse JSON from response: ' + cleaned.substring(0, 200));
    }
  }

  async fileToBase64(file) {
    const MAX_SIZE = 1024;
    const JPEG_QUALITY = 0.75;

    // Load the image
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Calculate scaled dimensions (cap longest edge at MAX_SIZE)
    let newW = width;
    let newH = height;
    if (width > MAX_SIZE || height > MAX_SIZE) {
      const scale = MAX_SIZE / Math.max(width, height);
      newW = Math.round(width * scale);
      newH = Math.round(height * scale);
    }

    // Draw onto an offscreen canvas and re-encode as JPEG
    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, newW, newH);
    bitmap.close();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }
}
