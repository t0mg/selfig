/**
 * Matcher module — uses Gemini to analyze a photo and select the best LEGO parts.
 * 
 * Strategy:
 * The catalog has ~1,125 parts but part names are generic ("MINI HEAD NO. 3377").
 * If we have pre-enriched descriptions, we use those. Otherwise we send a subset
 * of part images directly to Gemini alongside the user photo.
 * 
 * We split matching into per-category calls to stay within token limits and
 * improve response quality.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

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
   * @param {File} photoFile - The user's uploaded photo
   * @param {function} onProgress - Progress callback (step, message)
   * @returns {Promise<{parts: Array, reasoning: string}>}
   */
  async match(photoFile, onProgress = () => { }) {
    if (!this.catalog) await this.loadCatalog();

    // Convert photo to base64
    const photoBase64 = await this.fileToBase64(photoFile);

    onProgress(10, 'Analyzing your photo...');

    // First, get a description of the person in the photo
    const personDescription = await this.describePhoto(photoBase64);
    onProgress(25, 'Photo analyzed! Searching for matching parts...');

    // Match each category
    const results = [];

    // HEAD
    onProgress(30, 'Finding the perfect head...');
    const head = await this.matchCategory('BAM_HEAD', personDescription, photoBase64);
    results.push({ ...head, category: CATEGORY_ORDER[0] });

    // HEADWEAR
    onProgress(45, 'Selecting hair / headwear...');
    const headwear = await this.matchCategory('BAM_HEADWEAR', personDescription, photoBase64);
    results.push({ ...headwear, category: CATEGORY_ORDER[1] });

    // TORSO
    onProgress(55, 'Matching torso / outfit...');
    const torso = await this.matchCategory('BAM_TORSO', personDescription, photoBase64);
    results.push({ ...torso, category: CATEGORY_ORDER[2] });

    // LEGS
    onProgress(65, 'Picking the right legs...');
    const legs = await this.matchCategory('BAM_LEG', personDescription, photoBase64);
    results.push({ ...legs, category: CATEGORY_ORDER[3] });

    // ACCESSORIES (pick 2)
    onProgress(75, 'Choosing accessories...');
    const accessories = await this.matchAccessories(personDescription, photoBase64);
    results.push({ ...accessories[0], category: CATEGORY_ORDER[4] });
    results.push({ ...accessories[1], category: CATEGORY_ORDER[5] });

    onProgress(100, 'Done!');

    return { parts: results, personDescription };
  }

  async describePhoto(photoBase64) {
    const result = await this.model.generateContent([
      `Describe this person in detail for the purpose of creating a matching LEGO minifigure. Focus on:
1. Skin tone
2. Hair: color, style, length (or bald/hat)
3. Face: expression, glasses, facial hair, any distinctive features
4. Outfit: what they're wearing, colors, style
5. Accessories: anything they're holding or wearing (jewelry, backpack, etc.)
6. Overall vibe/personality that comes through

Be detailed but concise. This description will be used to select LEGO minifigure parts.`,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: photoBase64,
        },
      },
    ]);

    return result.response.text().trim();
  }

  async matchCategory(categoryKey, personDescription, photoBase64) {
    const parts = this.catalog[categoryKey];
    if (!parts || parts.length === 0) {
      return { partId: null, partName: 'Unknown', reason: 'No parts available' };
    }

    // Build part list text for the prompt
    const partsList = parts.map((p, i) => {
      const desc = this.hasDescriptions && p.description ? p.description : p.name;
      return `[${p.id}] ${desc}`;
    }).join('\n');

    const categoryLabels = {
      BAM_HEAD: 'head (face)',
      BAM_HEADWEAR: 'headwear or hair',
      BAM_TORSO: 'torso (upper body / outfit)',
      BAM_LEG: 'legs (lower body)',
    };

    const prompt = `You are helping create a LEGO minifigure that looks like a real person.

PERSON DESCRIPTION:
${personDescription}

AVAILABLE LEGO ${categoryLabels[categoryKey]?.toUpperCase() || categoryKey} PARTS:
${partsList}

Select the ONE part that best matches this person. Consider skin tone, expression, hair color/style, outfit, etc.

Respond ONLY in this exact JSON format (no markdown, no code blocks):
{"partId": "THE_ELEMENT_ID", "reason": "Brief explanation of why this part matches"}`;

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: photoBase64,
          },
        },
      ]);

      const text = result.response.text().trim();
      const parsed = this.parseJSON(text);

      // Find the matching part
      const part = parts.find(p => p.id === parsed.partId);
      if (part) {
        return {
          partId: part.id,
          designId: part.designId,
          partName: part.name,
          description: part.description || part.name,
          reason: parsed.reason || 'Best match',
          price: part.price,
          imageUrl: IMG_URL(part.id),
        };
      }
    } catch (error) {
      console.error(`Match failed for ${categoryKey}:`, error);
    }

    // Fallback: return first part
    const fallback = parts[0];
    return {
      partId: fallback.id,
      designId: fallback.designId,
      partName: fallback.name,
      description: fallback.description || fallback.name,
      reason: 'Default selection (matching failed)',
      price: fallback.price,
      imageUrl: IMG_URL(fallback.id),
    };
  }

  async matchAccessories(personDescription, photoBase64) {
    const parts = this.catalog['BAM_ACC'];
    if (!parts || parts.length < 2) {
      return [
        { partId: null, partName: 'None', reason: 'No accessories available' },
        { partId: null, partName: 'None', reason: 'No accessories available' },
      ];
    }

    const partsList = parts.map(p => {
      const desc = this.hasDescriptions && p.description ? p.description : p.name;
      return `[${p.id}] ${desc}`;
    }).join('\n');

    const prompt = `You are helping create a LEGO minifigure that looks like a real person.

PERSON DESCRIPTION:
${personDescription}

AVAILABLE LEGO ACCESSORIES:
${partsList}

Select exactly TWO accessories that would best suit this person. Consider what they're holding, wearing, or what fits their personality/vibe.

Respond ONLY in this exact JSON format (no markdown, no code blocks):
{"accessory1": {"partId": "ID", "reason": "Why"}, "accessory2": {"partId": "ID", "reason": "Why"}}`;

    try {
      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: photoBase64,
          },
        },
      ]);

      const text = result.response.text().trim();
      const parsed = this.parseJSON(text);

      const acc1 = parts.find(p => p.id === parsed.accessory1?.partId);
      const acc2 = parts.find(p => p.id === parsed.accessory2?.partId);

      return [
        acc1 ? {
          partId: acc1.id, designId: acc1.designId, partName: acc1.name,
          description: acc1.description || acc1.name,
          reason: parsed.accessory1?.reason || 'Best match',
          price: acc1.price, imageUrl: IMG_URL(acc1.id),
        } : this.fallbackAccessory(parts, 0),
        acc2 ? {
          partId: acc2.id, designId: acc2.designId, partName: acc2.name,
          description: acc2.description || acc2.name,
          reason: parsed.accessory2?.reason || 'Best match',
          price: acc2.price, imageUrl: IMG_URL(acc2.id),
        } : this.fallbackAccessory(parts, 1),
      ];
    } catch (error) {
      console.error('Accessory matching failed:', error);
      return [this.fallbackAccessory(parts, 0), this.fallbackAccessory(parts, 1)];
    }
  }

  fallbackAccessory(parts, index) {
    const p = parts[index] || parts[0];
    return {
      partId: p.id, designId: p.designId, partName: p.name,
      description: p.description || p.name,
      reason: 'Default selection',
      price: p.price, imageUrl: IMG_URL(p.id),
    };
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
    const JPEG_QUALITY = 0.85;

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
