import { Canvas, Rect, Circle, Triangle, Line, Textbox, FabricImage } from '/vendor/fabric/index.min.mjs';

const PRESETS = {
  postCover: { label: 'Post cover image (1200×400)', width: 1200, height: 400 },
  pageCover: { label: 'Page cover image (1600×500)', width: 1600, height: 500 },
  thumbnail: { label: 'Thumbnail (400×400)', width: 400, height: 400 },
  avatar: { label: 'Avatar (500×500)', width: 500, height: 500 },
  custom: { label: 'Custom size', width: 1200, height: 400 },
};

const SHAPE_DEFAULTS = { fill: '#4f9da6', stroke: '#22525a' };

let overlay, canvasEl, fabricCanvas, backgroundRect, resolvePromise;
let els = {};

function ensureBuilt() {
  if (overlay) return;
  overlay = document.getElementById('designer-overlay');
  canvasEl = document.getElementById('dz-canvas');

  els = {
    title: document.getElementById('designer-title'),
    filename: document.getElementById('dz-filename'),
    cancel: document.getElementById('dz-cancel'),
    save: document.getElementById('dz-save'),
    preset: document.getElementById('dz-preset'),
    customSize: document.getElementById('dz-custom-size'),
    width: document.getElementById('dz-width'),
    height: document.getElementById('dz-height'),
    applySize: document.getElementById('dz-apply-size'),
    bgColor: document.getElementById('dz-bg-color'),
    bgImageBtn: document.getElementById('dz-bg-image-btn'),
    bgClear: document.getElementById('dz-bg-clear'),
    overlaySlider: document.getElementById('dz-overlay'),
    addRect: document.getElementById('dz-add-rect'),
    addCircle: document.getElementById('dz-add-circle'),
    addTriangle: document.getElementById('dz-add-triangle'),
    addLine: document.getElementById('dz-add-line'),
    addText: document.getElementById('dz-add-text'),
    addImage: document.getElementById('dz-add-image'),
    objProps: document.getElementById('dz-object-props'),
    objFill: document.getElementById('dz-obj-fill'),
    objOpacity: document.getElementById('dz-obj-opacity'),
    objText: document.getElementById('dz-obj-text'),
    objForward: document.getElementById('dz-obj-forward'),
    objBackward: document.getElementById('dz-obj-backward'),
    objDelete: document.getElementById('dz-obj-delete'),
  };

  for (const key of Object.keys(PRESETS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = PRESETS[key].label;
    els.preset.appendChild(o);
  }

  els.preset.addEventListener('change', () => {
    els.customSize.hidden = els.preset.value !== 'custom';
    if (els.preset.value !== 'custom') resizeCanvas(PRESETS[els.preset.value].width, PRESETS[els.preset.value].height);
  });
  els.applySize.addEventListener('click', () => {
    const w = Math.max(100, Math.min(3000, parseInt(els.width.value, 10) || 1200));
    const h = Math.max(100, Math.min(3000, parseInt(els.height.value, 10) || 400));
    resizeCanvas(w, h);
  });

  els.bgColor.addEventListener('input', () => {
    fabricCanvas.backgroundImage = null;
    fabricCanvas.set('backgroundColor', els.bgColor.value);
    fabricCanvas.requestRenderAll();
  });
  els.bgImageBtn.addEventListener('click', () => pickImage((imgPath) => setBackgroundImage(imgPath)));
  els.bgClear.addEventListener('click', () => {
    fabricCanvas.backgroundImage = null;
    fabricCanvas.set('backgroundColor', els.bgColor.value);
    fabricCanvas.requestRenderAll();
  });
  els.overlaySlider.addEventListener('input', () => {
    const pct = Number(els.overlaySlider.value);
    backgroundRect.set('fill', `rgba(0,0,0,${(pct / 100).toFixed(2)})`);
    fabricCanvas.requestRenderAll();
  });

  els.addRect.addEventListener('click', () => addShape(new Rect({
    left: fabricCanvas.width / 2 - 100, top: fabricCanvas.height / 2 - 60,
    width: 200, height: 120, fill: SHAPE_DEFAULTS.fill,
  })));
  els.addCircle.addEventListener('click', () => addShape(new Circle({
    left: fabricCanvas.width / 2 - 60, top: fabricCanvas.height / 2 - 60,
    radius: 60, fill: SHAPE_DEFAULTS.fill,
  })));
  els.addTriangle.addEventListener('click', () => addShape(new Triangle({
    left: fabricCanvas.width / 2 - 70, top: fabricCanvas.height / 2 - 60,
    width: 140, height: 120, fill: SHAPE_DEFAULTS.fill,
  })));
  els.addLine.addEventListener('click', () => addShape(new Line(
    [0, 0, 200, 0],
    { left: fabricCanvas.width / 2 - 100, top: fabricCanvas.height / 2, stroke: SHAPE_DEFAULTS.stroke, strokeWidth: 5 }
  )));
  els.addText.addEventListener('click', () => addShape(new Textbox('Your text here', {
    left: fabricCanvas.width / 2 - 160, top: fabricCanvas.height / 2 - 30,
    width: 320, fontSize: 42, fill: '#ffffff', textAlign: 'center', fontWeight: '600',
  })));
  els.addImage.addEventListener('click', () => pickImage((imgPath) => addImageObject(imgPath)));

  els.objFill.addEventListener('input', () => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    obj.set(obj.type === 'line' ? 'stroke' : 'fill', els.objFill.value);
    fabricCanvas.requestRenderAll();
  });
  els.objOpacity.addEventListener('input', () => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    obj.set('opacity', Number(els.objOpacity.value) / 100);
    fabricCanvas.requestRenderAll();
  });
  els.objText.addEventListener('input', () => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    obj.set('text', els.objText.value);
    fabricCanvas.requestRenderAll();
  });
  els.objForward.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.bringObjectForward(obj); fabricCanvas.requestRenderAll(); }
  });
  els.objBackward.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.sendObjectBackwards(obj); fabricCanvas.requestRenderAll(); }
  });
  els.objDelete.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) { fabricCanvas.remove(obj); fabricCanvas.requestRenderAll(); }
  });

  els.cancel.addEventListener('click', () => close(null));
  els.save.addEventListener('click', saveAndUse);
}

let placementOffset = 0;

function addShape(obj) {
  // Nudge each successively-added object so they don't land exactly on top
  // of one another and become unreachable to click.
  const nudge = (placementOffset % 6) * 24;
  placementOffset += 1;
  obj.set({ left: obj.left + nudge, top: obj.top + nudge });
  fabricCanvas.add(obj);
  fabricCanvas.setActiveObject(obj);
  fabricCanvas.requestRenderAll();
}

async function addImageObject(imgPath) {
  const img = await FabricImage.fromURL(imgPath);
  const maxDim = Math.min(fabricCanvas.width, fabricCanvas.height) * 0.5;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  img.set({
    left: fabricCanvas.width / 2 - (img.width * scale) / 2,
    top: fabricCanvas.height / 2 - (img.height * scale) / 2,
    scaleX: scale, scaleY: scale,
  });
  addShape(img);
}

async function setBackgroundImage(imgPath) {
  const img = await FabricImage.fromURL(imgPath);
  const scale = Math.max(fabricCanvas.width / img.width, fabricCanvas.height / img.height);
  img.set({
    left: (fabricCanvas.width - img.width * scale) / 2,
    top: (fabricCanvas.height - img.height * scale) / 2,
    scaleX: scale, scaleY: scale,
    selectable: false, evented: false,
  });
  fabricCanvas.backgroundImage = img;
  fabricCanvas.requestRenderAll();
}

function resizeCanvas(width, height) {
  fabricCanvas.setDimensions({ width, height });
  backgroundRect.set({ width, height });
  fabricCanvas.requestRenderAll();
}

function onSelection() {
  const obj = fabricCanvas.getActiveObject();
  if (!obj || obj === backgroundRect) {
    els.objProps.hidden = true;
    return;
  }
  els.objProps.hidden = false;
  const isLine = obj.type === 'line';
  const isImage = obj.type === 'image';
  els.objFill.parentElement.style.display = isImage ? 'none' : '';
  els.objFill.value = toHex(isLine ? obj.stroke : obj.fill) || '#4f9da6';
  els.objOpacity.value = Math.round((obj.opacity ?? 1) * 100);
  els.objText.hidden = obj.type !== 'textbox';
  if (obj.type === 'textbox') els.objText.value = obj.text;
}

function toHex(color) {
  if (!color || typeof color !== 'string' || !color.startsWith('#')) return null;
  return color;
}

function pickImage(onChoose) {
  const pickerOverlay = document.getElementById('dz-picker-overlay');
  const grid = document.getElementById('dz-picker-grid');
  const uploadBtn = document.getElementById('dz-picker-upload-btn');
  const fileInput = document.getElementById('dz-picker-file');
  const cancelBtn = document.getElementById('dz-picker-cancel');

  async function refresh() {
    grid.innerHTML = '<p class="muted">Loading…</p>';
    const res = await fetch('/api/images');
    const images = await res.json();
    if (!images.length) {
      grid.innerHTML = '<p class="muted">No images yet. Upload one to get started.</p>';
      return;
    }
    grid.innerHTML = '';
    images.forEach(({ path }) => {
      const thumb = document.createElement('img');
      thumb.src = path;
      thumb.className = 'dz-picker-thumb';
      thumb.addEventListener('click', () => { done(path); });
      grid.appendChild(thumb);
    });
  }

  function done(path) {
    pickerOverlay.hidden = true;
    uploadBtn.onclick = null;
    cancelBtn.onclick = null;
    fileInput.onchange = null;
    if (path) onChoose(path);
  }

  uploadBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/images', { method: 'POST', body: fd });
    const data = await res.json();
    fileInput.value = '';
    if (res.ok) done(data.path);
  };
  cancelBtn.onclick = () => done(null);

  pickerOverlay.hidden = false;
  refresh();
}

async function saveAndUse() {
  fabricCanvas.discardActiveObject();
  fabricCanvas.requestRenderAll();
  const dataUrl = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
  const res = await fetch('/api/images/from-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename: els.filename.value.trim() || 'graphic' }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Could not save the graphic');
    return;
  }
  close({ path: data.path });
}

function close(result) {
  overlay.hidden = true;
  if (fabricCanvas) { fabricCanvas.dispose(); fabricCanvas = null; }
  const r = resolvePromise;
  resolvePromise = null;
  if (r) r(result);
}

/**
 * Opens the graphics designer modal. Resolves with { path } if the user
 * saves a graphic, or null if they cancel.
 */
export function openDesigner({ presetKey = 'postCover', title = 'Graphics Designer', suggestedName = 'graphic', initialImage } = {}) {
  ensureBuilt();
  els.title.textContent = title;
  els.filename.value = suggestedName;
  els.preset.value = presetKey;
  els.customSize.hidden = presetKey !== 'custom';

  const preset = PRESETS[presetKey] || PRESETS.postCover;
  els.width.value = preset.width;
  els.height.value = preset.height;

  fabricCanvas = new Canvas(canvasEl, { width: preset.width, height: preset.height });
  fabricCanvas.set('backgroundColor', '#ffffff');
  backgroundRect = new Rect({
    left: 0, top: 0, width: preset.width, height: preset.height,
    fill: 'rgba(0,0,0,0)', selectable: false, evented: false,
  });
  fabricCanvas.add(backgroundRect);
  fabricCanvas.on('selection:created', onSelection);
  fabricCanvas.on('selection:updated', onSelection);
  fabricCanvas.on('selection:cleared', onSelection);

  els.bgColor.value = '#ffffff';
  els.overlaySlider.value = 0;
  els.objProps.hidden = true;
  placementOffset = 0;

  if (initialImage) setBackgroundImage(initialImage);

  overlay.hidden = false;

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}
