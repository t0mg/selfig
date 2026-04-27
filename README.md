# 🧱 Selfig

**Turn yourself into a LEGO minifigure with AI.**

Upload a photo or take a selfie — Selfig uses Google Gemini to analyze your appearance and match you to the closest combination of LEGO [Build a Minifigure](https://www.lego.com/pick-and-build/create-a-minifigure) parts.

Try it live: https://t0mg.github.io/selfig/ (you'll need your own [Google Gemini API key](https://aistudio.google.com/app/apikey))

## ✨ Features

- **Photo upload** or **webcam selfie** capture
- **AI-powered matching** via Gemini 3.1 Flash Lite; analyzes face, hair, expression, outfit, and accessories
- **1,125 real LEGO parts** across 5 categories (head, headwear/hair, torso, legs, accessories)
- **Parts list** with one-click copy for easy reference
- **Rich AI descriptions** for each part (pre-generated via Gemini Vision)
- **Direct link** to the LEGO minifigure builder

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) (free tier available)

### Install & Run

```bash
git clone https://github.com/t0mg/selfig.git
cd selfig
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter your Gemini API key, and upload a photo!

## 🔧 How It Works

### 1. Catalog Scraping

The LEGO minifigure builder exposes a GraphQL API. The `scripts/fetch-catalog.mjs` script fetches all available parts:

| Category | Count |
|---|---|
| Head | 104 |
| Headwear / Hair | 427 |
| Torso | 217 |
| Legs | 111 |
| Accessory | 266 |
| **Total** | **1,125** |

### 2. Catalog Enrichment

Part names from the API are generic (e.g. "MINI HEAD NO. 3377"). The `scripts/enrich-catalog.mjs` script sends each part's image to Gemini Vision to generate rich text descriptions like:

> *"Yellow head with brown mustache, wide grin, and slightly raised eyebrows. Dual-sided: reverse shows surprised expression."*

### 3. AI Matching

When a user uploads a photo, the app:
1. **Describes the person** via Gemini (skin tone, hair, outfit, vibe)
2. **Matches per category**: sends the description + full parts catalog to Gemini, which selects the best match
3. **Picks 2 accessories** based on personality/context
4. **Generates reasoning**: a short summary of why each part was chosen

## 📁 Project Structure

```
selfig/
├── index.html              # Main HTML
├── src/
│   ├── main.js             # App entry point & UI orchestration
│   ├── matcher.js          # Gemini matching engine
│   ├── camera.js           # Webcam module
│   └── style.css           # Design system
├── scripts/
│   ├── fetch-catalog.mjs   # Scrape LEGO GraphQL API
│   ├── download-images.mjs # Download part images from CDN
│   └── enrich-catalog.mjs  # Generate AI descriptions
├── public/
│   └── data/
│       └── catalog-final.json  # Enriched catalog (committed)
├── data/                   # Scraped data (gitignored)
│   ├── catalog.json
│   ├── catalog-enriched.json
│   └── images/
└── .github/
    └── workflows/
        └── deploy.yml      # GitHub Pages deployment
```

## 🛠️ Scripts

### Refresh the catalog

```bash
# 1. Fetch parts from LEGO API
node scripts/fetch-catalog.mjs

# 2. Download all part images (~50MB)
node scripts/download-images.mjs

# 3. Enrich with AI descriptions (requires API key)
# PowerShell:
$env:GEMINI_API_KEY="your_key_here"
node scripts/enrich-catalog.mjs

# Bash:
GEMINI_API_KEY=your_key_here node scripts/enrich-catalog.mjs

# 4. Copy enriched catalog for production
cp data/catalog-final.json public/data/catalog-final.json
```

## 📄 License

MIT

## ⚠️ Disclaimer

Selfig is a fan-made project and is not affiliated with the LEGO Group. LEGO® is a trademark of the LEGO Group.
