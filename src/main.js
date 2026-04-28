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
const camera = new Camera();

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

function displayResults(result) {
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
  if (acc1?.imageUrl) {
    const accDiv = document.createElement('div');
    accDiv.className = 'minifig-accessory';
    const img = document.createElement('img');
    img.src = acc1.imageUrl;
    img.alt = acc1.partName;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    accDiv.appendChild(img);
    minifigAssembly.appendChild(accDiv);
  }

  // Central body stack
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'minifig-body';
  const bodyOrder = ['BAM_HEADWEAR', 'BAM_HEAD', 'BAM_TORSO', 'BAM_LEG'];
  for (const catKey of bodyOrder) {
    const part = parts.find(p => p.category.key === catKey);
    if (part?.imageUrl) {
      const img = document.createElement('img');
      img.src = part.imageUrl;
      img.alt = part.partName;
      img.className = 'minifig-part';
      img.dataset.cat = catKey;
      img.loading = 'lazy';
      img.onerror = () => { img.style.display = 'none'; };
      bodyDiv.appendChild(img);
    }
  }
  minifigAssembly.appendChild(bodyDiv);

  // Right accessory
  if (acc2?.imageUrl) {
    const accDiv = document.createElement('div');
    accDiv.className = 'minifig-accessory';
    const img = document.createElement('img');
    img.src = acc2.imageUrl;
    img.alt = acc2.partName;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    accDiv.appendChild(img);
    minifigAssembly.appendChild(accDiv);
  }

  // Part detail cards
  partsGrid.innerHTML = '';

  parts.forEach((part, i) => {
    if (!part.partId) return;

    const card = document.createElement('div');
    card.className = 'part-card';
    card.style.animationDelay = `${i * 0.1}s`;

    card.innerHTML = `
      <div class="part-card-label">${part.category.emoji} ${part.category.label}</div>
      <img
        class="part-card-image"
        src="${part.imageUrl}"
        alt="${part.partName}"
        loading="lazy"
        onerror="this.style.opacity='0.3'"
      />
      <div class="part-card-name">${cleanPartName(part.partName)}</div>
      <div class="part-card-desc">${part.reason}</div>
      ${part.price ? `<div class="part-card-price">${part.price.formattedAmount}</div>` : ''}
    `;

    partsGrid.appendChild(card);
  });

  // Parts list
  partsList.innerHTML = '';
  parts.forEach(part => {
    if (!part.partId) return;
    const row = document.createElement('div');
    row.className = 'parts-list-row';
    row.innerHTML = `
      <span class="parts-list-cat">${part.category.label}</span>
      <span class="parts-list-id">${part.partId}</span>
      <span class="parts-list-name">${cleanPartName(part.partName)}</span>
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

// ── Retry ──
function initRetry() {
  retryBtn.addEventListener('click', () => {
    currentPhoto = null;
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
