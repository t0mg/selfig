/**
 * Fetches the complete LEGO minifigure parts catalog from the LEGO GraphQL API.
 * Outputs a JSON file with all parts organized by category.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GRAPHQL_URL = 'https://www.lego.com/api/graphql/BAMElements';

const QUERY = `query BAMElements($first: Int, $after: String, $input: MinifigureSearchInput!) {
  searchMinifigureElements(first: $first, after: $after, input: $input) {
    edges {
      node {
        id
        designId
        name
        imageUrl
        maxOrderQuantity
        deliveryChannel
        isShort
        price {
          currencyCode
          centAmount
          formattedAmount
          formattedValue
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const CATEGORIES = [
  'BAM_HEAD',
  'BAM_HEADWEAR', 
  'BAM_TORSO',
  'BAM_LEG',
  'BAM_ACC'
];

const CATEGORY_LABELS = {
  BAM_HEAD: 'Head',
  BAM_HEADWEAR: 'Headwear / Hair',
  BAM_TORSO: 'Torso',
  BAM_LEG: 'Legs',
  BAM_ACC: 'Accessory'
};

async function fetchCategory(categoryType) {
  const allNodes = [];
  let after = null;
  let hasNext = true;
  let page = 0;

  while (hasNext && page < 20) {
    const variables = {
      first: 200,
      input: { categoryType }
    };
    if (after) variables.after = after;

    console.log(`  Fetching ${categoryType} page ${page + 1}...`);

    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-locale': 'en-GB',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        operationName: 'BAMElements',
        variables,
        query: QUERY
      })
    });

    if (!response.ok) {
      console.error(`  HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(`  Body: ${text.substring(0, 500)}`);
      break;
    }

    const json = await response.json();

    if (json.errors) {
      console.error(`  GraphQL errors:`, json.errors);
      break;
    }

    const data = json.data.searchMinifigureElements;
    const nodes = data.edges.map(e => e.node);
    allNodes.push(...nodes);
    
    hasNext = data.pageInfo.hasNextPage;
    after = data.pageInfo.endCursor;
    page++;

    console.log(`  Got ${nodes.length} items (total: ${allNodes.length}), hasNext: ${hasNext}`);
  }

  return allNodes;
}

async function main() {
  console.log('Fetching LEGO minifigure parts catalog...\n');

  const catalog = {};
  const summary = {};

  for (const cat of CATEGORIES) {
    console.log(`\n📦 Category: ${CATEGORY_LABELS[cat]} (${cat})`);
    const items = await fetchCategory(cat);
    catalog[cat] = items.map(item => ({
      id: item.id,
      designId: item.designId,
      name: item.name,
      imageUrl: item.imageUrl,
      thumbnailUrl: item.id ? `https://www.lego.com/cdn/mff/optimised/thumbnails/${item.id}_0.webp` : null,
      price: item.price,
      maxOrderQuantity: item.maxOrderQuantity,
      isShort: item.isShort
    }));
    summary[cat] = items.length;
    console.log(`  ✅ ${items.length} items fetched`);
  }

  console.log('\n\n=== CATALOG SUMMARY ===');
  for (const [cat, count] of Object.entries(summary)) {
    console.log(`  ${CATEGORY_LABELS[cat]}: ${count} items`);
  }
  console.log(`  TOTAL: ${Object.values(summary).reduce((a, b) => a + b, 0)} items`);

  // Save catalog
  const outputDir = join(__dirname, '..', 'data');
  mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, 'catalog.json');
  writeFileSync(outputPath, JSON.stringify({ 
    fetchedAt: new Date().toISOString(),
    summary,
    categories: CATEGORY_LABELS,
    catalog 
  }, null, 2));

  console.log(`\n💾 Catalog saved to ${outputPath}`);
}

main().catch(console.error);
