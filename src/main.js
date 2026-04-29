/**
 * Selfig — Main Application
 * Wires together the camera, matcher, and UI.
 */

import './style.css';
import { Camera } from './camera.js';
import { Matcher } from './matcher.js';

// ── State ──
let matcher = null;
let currentPhoto = null;
let currentDescription = null;
const camera = new Camera();

// Register Service Worker for Image Caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Determine the base path dynamically if hosted on GitHub Pages
    const basePath = window.location.pathname.endsWith('/')
      ? window.location.pathname
      : window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    navigator.serviceWorker.register(`${basePath}sw.js`).catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ── DOM Elements ──
const $ = (id) => document.getElementById(id);

const apiKeySection = $('api-key-section');
const apiKeyInput = $('api-key-input');
const apiKeySubmit = $('api-key-submit');
const mainContent = $('main-content');

const uploadArea = $('upload-area');
const uploadPlaceholder = $('upload-placeholder');
const uploadPreview = $('upload-preview');
const fileInput = $('file-input');
const cameraBtn = $('camera-btn');
const matchBtn = $('match-btn');

const cameraModal = $('camera-modal');
const cameraClose = $('camera-close');
const cameraCapture = $('camera-capture');
const cameraSwitch = $('camera-switch');

const uploadSection = $('upload-section');
const matchingSection = $('matching-section');
const matchingPhotoImg = $('matching-photo-img');
const matchingStatus = $('matching-status');
const progressFill = $('progress-fill');

const resultsSection = $('results-section');
const resultSourceImg = $('result-source-img');
const minifigAssembly = $('minifig-assembly');
const partsGrid = $('parts-grid');
const partsList = $('parts-list');
const copyPartsBtn = $('copy-parts-btn');
const legoLink = $('lego-link');
const rematchBtn = $('rematch-btn');
const retryBtn = $('retry-btn');

// ── Toast ──
function showToast(message, duration = 4000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => {
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), duration);
  });
}

// ── Step Management ──
function setStep(step) {
  document.querySelectorAll('.step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s === step);
    el.classList.toggle('completed', s < step);
  });

  uploadSection.classList.toggle('hidden', step !== 1);
  matchingSection.classList.toggle('hidden', step !== 2);
  resultsSection.classList.toggle('hidden', step !== 3);

  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── API Key ──
function initApiKey() {
  // Check localStorage
  const saved = localStorage.getItem('selfig_api_key');
  if (saved) {
    activateApp(saved);
    return;
  }

  apiKeySubmit.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showToast('Please enter your Gemini API key');
      return;
    }
    localStorage.setItem('selfig_api_key', key);
    activateApp(key);
  });

  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apiKeySubmit.click();
  });
}

function activateApp(apiKey) {
  matcher = new Matcher(apiKey);
  apiKeySection.classList.add('hidden');
  mainContent.classList.remove('hidden');
  setStep(1);

  // Pre-load catalog
  matcher.loadCatalog().catch(err => {
    console.error('Failed to load catalog:', err);
  });
}

// ── Photo Upload ──
function initUpload() {
  // Click to browse
  uploadArea.addEventListener('click', (e) => {
    if (e.target.closest('#match-btn') || e.target.closest('#camera-btn')) return;
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handlePhoto(e.target.files[0]);
  });

  // Drag & drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      handlePhoto(file);
    } else {
      showToast('Please drop an image file');
    }
  });

  // Match button
  matchBtn.addEventListener('click', startMatching);
}

function handlePhoto(file) {
  currentPhoto = file;

  const url = URL.createObjectURL(file);
  uploadPreview.src = url;
  uploadPreview.classList.remove('hidden');
  uploadPlaceholder.classList.add('hidden');
  matchBtn.classList.remove('hidden');
  matchBtn.disabled = false;

  // Animate the preview in
  uploadPreview.style.animation = 'fadeSlideUp 0.3s ease-out';
}

// ── Camera ──
function initCamera() {
  cameraBtn.addEventListener('click', async () => {
    try {
      await camera.open();
    } catch (error) {
      showToast(error.message);
    }
  });

  cameraClose.addEventListener('click', () => camera.close());
  document.querySelector('.modal-backdrop')?.addEventListener('click', () => camera.close());

  cameraSwitch.addEventListener('click', async () => {
    try {
      await camera.switchCamera();
    } catch (error) {
      showToast('Could not switch camera');
    }
  });

  cameraCapture.addEventListener('click', async () => {
    const file = await camera.capture();
    camera.close();
    handlePhoto(file);
  });
}

// ── Matching ──
async function startMatching() {
  if (!currentPhoto || !matcher) return;

  setStep(2);

  // Set the small photo in the matching animation
  matchingPhotoImg.src = URL.createObjectURL(currentPhoto);
  progressFill.style.width = '0%';

  try {
    const result = await matcher.match(currentPhoto, (progress, message) => {
      progressFill.style.width = `${progress}%`;
      matchingStatus.textContent = message;
    });
    currentDescription = result.personDescription;

    displayResults(result);
    setStep(3);
  } catch (error) {
    console.error('Matching failed:', error);

    if (error.message?.includes('API_KEY') || error.message?.includes('401') || error.message?.includes('403')) {
      showToast('Invalid API key. Please check your Gemini API key.');
      localStorage.removeItem('selfig_api_key');
      setTimeout(() => location.reload(), 2000);
    } else {
      showToast('Matching failed: ' + error.message);
      setStep(1);
    }
  }
}

// ── Results ──
let lastResultParts = [];

function displayResults(result, animate = true) {
  const { parts } = result;
  lastResultParts = parts;

  // Source photo
  resultSourceImg.src = URL.createObjectURL(currentPhoto);

  // Minifig assembly — body stacked vertically, accessories on either side
  minifigAssembly.innerHTML = '';

  // Find accessories
  const acc1 = parts.find(p => p.category.key === 'BAM_ACC');
  const acc2 = parts.find(p => p.category.key === 'BAM_ACC_2');

  // Left accessory
  const accDiv1 = document.createElement('div');
  accDiv1.className = 'minifig-accessory';
  const img1 = document.createElement('img');
  img1.dataset.cat = 'BAM_ACC';
  img1.loading = 'eager';
  img1.onerror = () => { img1.style.display = 'none'; };
  if (acc1?.imageUrl) {
    img1.src = acc1.imageUrl;
    img1.alt = acc1.partName;
  } else {
    img1.style.display = 'none';
  }
  accDiv1.appendChild(img1);
  minifigAssembly.appendChild(accDiv1);

  // Central body stack
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'minifig-body';
  const bodyOrder = ['BAM_HEADWEAR', 'BAM_HEAD', 'BAM_TORSO', 'BAM_LEG'];
  for (const catKey of bodyOrder) {
    const part = parts.find(p => p.category.key === catKey);
    const img = document.createElement('img');
    img.dataset.cat = catKey;
    img.className = 'minifig-part';
    img.loading = 'eager';
    img.onerror = () => { img.style.display = 'none'; };
    if (part?.imageUrl) {
      img.src = part.imageUrl;
      img.alt = part.partName;
    } else {
      img.style.display = 'none';
    }
    bodyDiv.appendChild(img);
  }
  minifigAssembly.appendChild(bodyDiv);

  // Right accessory
  const accDiv2 = document.createElement('div');
  accDiv2.className = 'minifig-accessory';
  const img2 = document.createElement('img');
  img2.dataset.cat = 'BAM_ACC_2';
  img2.loading = 'eager';
  img2.onerror = () => { img2.style.display = 'none'; };
  if (acc2?.imageUrl) {
    img2.src = acc2.imageUrl;
    img2.alt = acc2.partName;
  } else {
    img2.style.display = 'none';
  }
  accDiv2.appendChild(img2);
  minifigAssembly.appendChild(accDiv2);

  // Part detail cards
  partsGrid.innerHTML = '';

  parts.forEach((part, i) => {
    if (!part.partId) return;

    const card = document.createElement('div');
    card.className = 'part-card';
    if (!animate) {
      card.style.animation = 'none';
    } else {
      card.style.animationDelay = `${i * 0.1}s`;
    }

    let cycleBtnHtml = '';
    if (part.options && part.options.length > 1) {
      cycleBtnHtml = `
        <button class="btn-cycle" aria-label="Cycle option" title="Swap part">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
      `;
    }

    card.innerHTML = `
      ${cycleBtnHtml}
      <div class="part-card-label">${part.category.emoji} ${part.category.label}</div>
      <img
        class="part-card-image"
        src="${part.imageUrl}"
        alt="${part.partName}"
        loading="eager"
        onerror="this.style.opacity='0.3'"
      />
      <div class="part-card-name">${cleanPartName(part.partName)}</div>
      <div class="part-card-desc">${part.reason}</div>
      ${part.price ? `<div class="part-card-price">${part.price.formattedAmount}</div>` : ''}
    `;

    if (part.options && part.options.length > 1) {
      const btn = card.querySelector('.btn-cycle');
      btn.addEventListener('click', (e) => {
        // Prevent default in case it bubbles
        e.stopPropagation();

        part.currentIndex = (part.currentIndex + 1) % part.options.length;
        const newOption = part.options[part.currentIndex];

        // Update top-level properties
        Object.assign(part, newOption);

        // Update Card DOM directly
        const imgEl = card.querySelector('.part-card-image');
        if (part.imageUrl) {
          imgEl.src = part.imageUrl;
          imgEl.alt = part.partName;
          imgEl.style.opacity = '1';
        } else {
          imgEl.removeAttribute('src');
          imgEl.style.opacity = '0';
        }
        card.querySelector('.part-card-name').textContent = cleanPartName(part.partName);
        card.querySelector('.part-card-desc').textContent = part.reason;
        
        const priceEl = card.querySelector('.part-card-price');
        if (part.price) {
          if (priceEl) priceEl.textContent = part.price.formattedAmount;
          else card.insertAdjacentHTML('beforeend', `<div class="part-card-price">${part.price.formattedAmount}</div>`);
        } else if (priceEl) {
          priceEl.remove();
        }

        // Update Assembly DOM directly
        const assemblyImg = minifigAssembly.querySelector(`img[data-cat="${part.category.key}"]`);
        if (assemblyImg) {
          if (part.imageUrl) {
            assemblyImg.src = part.imageUrl;
            assemblyImg.alt = part.partName;
            assemblyImg.style.display = 'block';
          } else {
            assemblyImg.removeAttribute('src');
            assemblyImg.style.display = 'none';
          }
        }

        // Update Parts List DOM directly
        const listRow = partsList.querySelector(`div[data-cat="${part.category.key}"]`);
        if (listRow) {
          if (part.partId) {
            listRow.style.display = '';
            listRow.querySelector('.parts-list-id').textContent = part.partId;
            listRow.querySelector('.parts-list-name').textContent = cleanPartName(part.partName);
          } else {
            listRow.style.display = 'none';
          }
        }
      });
    }

    partsGrid.appendChild(card);
  });

  // Prefetch alternate options into the Service Worker cache
  if (animate) {
    parts.forEach(part => {
      if (part.options && part.options.length > 1) {
        part.options.forEach(opt => {
          if (opt && opt.imageUrl) {
            // Using no-cors mode allows the browser to cache opaque responses 
            // from the CDN without needing CORS headers from the server.
            fetch(opt.imageUrl, { mode: 'no-cors' }).catch(() => { });
          }
        });
      }
    });
  }

  // Parts list
  partsList.innerHTML = '';
  parts.forEach(part => {
    const row = document.createElement('div');
    row.className = 'parts-list-row';
    row.dataset.cat = part.category.key;
    if (!part.partId) {
      row.style.display = 'none';
    }
    row.innerHTML = `
      <span class="parts-list-cat">${part.category.label}</span>
      <span class="parts-list-id">${part.partId || ''}</span>
      <span class="parts-list-name">${part.partId ? cleanPartName(part.partName) : ''}</span>
    `;
    partsList.appendChild(row);
  });

  // AI Reasoning removed to optimize LLM usage

  // LEGO builder link
  legoLink.href = 'https://www.lego.com/fr-fr/pick-and-build/create-a-minifigure?open=true';
}

function cleanPartName(name) {
  // Make the generic names more readable
  return name
    .replace(/MINI HEAD,?\s*"?NO\.?\s*/i, 'Head #')
    .replace(/MINI HEAD\s*"?NO\.?\s*/i, 'Head #')
    .replace(/MINI UPPER PART,?\s*NO\.?\s*/i, 'Torso #')
    .replace(/MINI LOWER PART,?\s*NO\.?\s*/i, 'Legs #')
    .replace(/MINI WIG\s*NO\.?\s*/i, 'Wig #')
    .replace(/MINI FIGURE WIG\s*NO\.?\s*/i, 'Wig #')
    .replace(/MINI SKIRT,?\s*NO\.?\s*/i, 'Skirt #')
    .replace(/HAT\s*NO\.?\s*/i, 'Hat #')
    .replace(/"$/g, '')
    .replace(/"/g, '');
}

// ── Retry & Rematch ──
function initRetry() {
  rematchBtn.addEventListener('click', () => {
    startMatching();
  });

  retryBtn.addEventListener('click', () => {
    currentPhoto = null;
    currentDescription = null;
    uploadPreview.classList.add('hidden');
    uploadPlaceholder.classList.remove('hidden');
    matchBtn.classList.add('hidden');
    fileInput.value = '';
    setStep(1);
  });
}

// ── Copy Parts List ──
function initCopyParts() {
  copyPartsBtn.addEventListener('click', () => {
    if (!lastResultParts.length) return;

    const text = lastResultParts
      .filter(p => p.partId)
      .map(p => `${p.category.label}: ${p.partId} — ${cleanPartName(p.partName)}`)
      .join('\n');

    navigator.clipboard.writeText(text).then(() => {
      copyPartsBtn.classList.add('copied');
      copyPartsBtn.querySelector('span').textContent = 'Copied!';
      setTimeout(() => {
        copyPartsBtn.classList.remove('copied');
        copyPartsBtn.querySelector('span').textContent = 'Copy';
      }, 2000);
    }).catch(() => {
      showToast('Failed to copy to clipboard');
    });
  });
}

// ── Init ──
function init() {
  initApiKey();
  initUpload();
  initCamera();
  initRetry();
  initCopyParts();
}

// Module scripts run after DOM parsing, so just call init directly
init();
