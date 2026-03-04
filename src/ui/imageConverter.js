/**
 * Arduboy Image Converter — UI Controller.
 *
 * Manages the Image tab: file loading, preview rendering, conversion
 * settings, code generation, and clipboard / download actions.
 */

import {
  loadImageFileOriginal,
  convertImageFormat,
  generateUsageSnippet,
  generateFullSketch,
  OUTPUT_FORMAT,
} from '../core/index.js';
import { downloadBlob } from './files.js';
import { showToast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

export class ImageConverter {
  /** @type {ImageData|null} */ _imageData = null;
  /** @type {string} */ _fileName = '';
  /** @type {Object|null} */ _lastResult = null;

  constructor() {
    this._grabRefs();
    this._bindEvents();
    this._renderThresholdPreview = this._renderThresholdPreview.bind(this);
  }

  // ── DOM refs ────────────────────────────────────────────────────────────

  _grabRefs() {
    this._fileInput        = $('#img-file');
    this._fileLabel        = $('label[for="img-file"]');
    this._previewSection   = $('#img-preview-section');
    this._previewCanvas    = $('#img-preview-canvas');
    this._dimensionsEl     = $('#img-dimensions');

    this._spriteSettings   = $('#img-sprite-settings');
    this._accordionToggle  = $('#img-accordion-toggle');
    this._accordionContent = $('#img-accordion-content');
    this._frameWidthInput  = $('#img-frame-width');
    this._frameHeightInput = $('#img-frame-height');
    this._spacingInput     = $('#img-spacing');
    this._frameInfo        = $('#img-frame-info');
    this._frameStrip       = $('#img-frame-strip');
    this._frameMore        = $('#img-frame-more');
    this._formatSelect     = $('#img-format');
    this._varnameInput     = $('#img-varname');
    this._thresholdSlider  = $('#img-threshold');
    this._thresholdValue   = $('#img-threshold-value');
    this._outputGroup      = $('#img-output-group');
    this._outputInfo       = $('#img-output-info');
    this._codeOutput       = $('#img-code-output');
    this._usageGroup       = $('#img-usage-group');
    this._usageOutput      = $('#img-usage-output');
    this._fullSketchCb     = $('#img-full-sketch');
    this._btnCopy          = $('#btn-img-copy');
    this._btnDownload      = $('#btn-img-download');
    this._btnCopyUsage     = $('#btn-img-copy-usage');
    this._btnCopyIcon      = $('#btn-img-copy-icon');
    this._btnCopyUsageIcon = $('#btn-img-copy-usage-icon');
    this._formatWarning    = $('#img-format-warning');
    this._formatWarningText = $('#img-format-warning-text');
    this._formatSwitchLink = $('#img-format-switch-link');
    this._manualOffsetRow  = $('#img-manual-offset-row');
    this._manualOffsetCb   = $('#img-manual-offset');
    this._firstFrameNotice = $('#img-first-frame-notice');
    this._btnCopyBytes     = $('#btn-img-copy-bytes');
  }

  // ── Event binding ───────────────────────────────────────────────────────

  _bindEvents() {
    // File input
    this._fileInput?.addEventListener('change', () => {
      const file = this._fileInput.files?.[0];
      if (file) this._handleFileLoaded(file);
    });

    // Accordion toggle
    this._accordionToggle?.addEventListener('click', () => {
      this._toggleAccordion();
    });

    // Settings changes -> re-convert
    const reConvert = () => this._updateConversion();
    this._frameWidthInput?.addEventListener('input', reConvert);
    this._frameHeightInput?.addEventListener('input', reConvert);
    this._spacingInput?.addEventListener('input', reConvert);
    this._formatSelect?.addEventListener('change', reConvert);
    this._varnameInput?.addEventListener('input', reConvert);

    // Threshold slider
    this._thresholdSlider?.addEventListener('input', () => {
      if (this._thresholdValue) {
        this._thresholdValue.textContent = this._thresholdSlider.value;
      }
      this._updateConversion();
      this._renderThresholdPreview();
    });

    // Full sketch toggle
    this._fullSketchCb?.addEventListener('change', () => this._updateUsageDisplay());

    // Copy code
    this._btnCopy?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Code copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Copy code icon
    this._btnCopyIcon?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Code copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Download .h
    this._btnDownload?.addEventListener('click', () => {
      const text = this._codeOutput?.textContent;
      if (!text) return;
      const name = this._sanitizeName(this._varnameInput?.value || 'image');
      const blob = new Blob([text], { type: 'text/plain' });
      downloadBlob(blob, `${name}.h`);
    });

    // Copy usage
    this._btnCopyUsage?.addEventListener('click', () => {
      const text = this._usageOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Example copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Copy usage icon
    this._btnCopyUsageIcon?.addEventListener('click', () => {
      const text = this._usageOutput?.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(
          () => showToast('Example copied to clipboard', 'success'),
          () => showToast('Failed to copy', 'error'),
        );
      }
    });

    // Format switch link (in the sprite sheet warning)
    this._formatSwitchLink?.addEventListener('click', (e) => {
      e.preventDefault();
      const target = this._formatSwitchLink.dataset.targetFormat;
      if (target && this._formatSelect) {
        this._formatSelect.value = target;
        this._updateConversion();
        this._formatSelect.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Manual pointer offset toggle
    this._manualOffsetCb?.addEventListener('change', () => this._updateConversion());

    // Preview scale radio group
    document.querySelectorAll('input[name="img-preview-scale"]').forEach(r => {
      r.addEventListener('change', () => this._applyPreviewScale());
    });

    // Frame strip scale chooser
    document.querySelectorAll('input[name="img-strip-scale"]').forEach(r => {
      r.addEventListener('change', () => this._renderFrameStrip());
    });

    // Custom number spinner buttons
    document.querySelectorAll('.img-num-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;

        const currentVal = parseInt(input.value, 10) || 0;
        const step = 1;
        const min = parseInt(input.min, 10) || 0;
        const max = parseInt(input.max, 10) || Infinity;

        let newVal = currentVal;
        if (btn.classList.contains('img-num-btn-up')) {
          newVal = Math.min(currentVal + step, max);
        } else if (btn.classList.contains('img-num-btn-down')) {
          newVal = Math.max(currentVal - step, min);
        }

        input.value = newVal;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // Copy bytes only
    this._btnCopyBytes?.addEventListener('click', () => {
      const code = this._codeOutput?.textContent;
      if (!code) return;
      const bytes = this._extractBytesOnly(code);
      navigator.clipboard.writeText(bytes).then(
        () => showToast('Bytes copied to clipboard', 'success'),
        () => showToast('Failed to copy', 'error'),
      );
    });
  }

  // ── Public API (called from main.js on drag-drop) ──────────────────────

  async loadFile(file) {
    await this._handleFileLoaded(file);
  }

  // ── File loading ────────────────────────────────────────────────────────

  async _handleFileLoaded(file) {
    try {
      this._imageData = await loadImageFileOriginal(file);
      this._fileName = file.name;
    } catch {
      showToast('Failed to load image', 'error');
      return;
    }

    // Update label
    if (this._fileLabel) {
      this._fileLabel.textContent = file.name;
      this._fileLabel.classList.add('has-file');
    }

    // Render preview
    this._renderPreview();
    this._renderThresholdPreview();

    // Show dimensions
    const w = this._imageData.width;
    const h = this._imageData.height;
    if (this._dimensionsEl) {
      this._dimensionsEl.textContent = `${w} \u00d7 ${h} px`;
    }
    this._previewSection?.classList.remove('hidden');

    // Show settings and sprite settings, default frame size to full image
    if (this._frameWidthInput) this._frameWidthInput.value = w;
    if (this._frameHeightInput) this._frameHeightInput.value = h;
    if (this._spacingInput) this._spacingInput.value = 0;
    this._spriteSettings?.classList.remove('hidden');
    
    // Show settings group but keep accordion collapsed
    const settingsGroup = document.getElementById('img-settings-group');
    settingsGroup?.classList.remove('hidden');

    // Derive a default variable name from filename
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    if (this._varnameInput && baseName) {
      this._varnameInput.value = baseName;
    }

    // Run initial conversion
    this._updateConversion();
  }

  // ── Preview rendering ───────────────────────────────────────────────────

  _renderPreview() {
    if (!this._imageData || !this._previewCanvas) return;
    const w = this._imageData.width;
    const h = this._imageData.height;

    // Set canvas to native image size (CSS will scale it)
    this._previewCanvas.width = w;
    this._previewCanvas.height = h;
    const ctx = this._previewCanvas.getContext('2d');
    ctx.putImageData(this._imageData, 0, 0);
    this._applyPreviewScale();
  }

  // Render thresholded preview
  _renderThresholdPreview() {
    if (!this._imageData || !this._previewCanvas) return;
    const w = this._imageData.width;
    const h = this._imageData.height;
    const threshold = parseInt(this._thresholdSlider?.value, 10) ?? 128;
    // Create a new ImageData for preview
    const src = this._imageData.data;
    const preview = new ImageData(w, h);
    const dst = preview.data;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      // Use green channel for brightness (same as conversion)
      const brightness = src[idx + 1];
      const value = brightness > threshold ? 255 : 0;
      dst[idx] = value;
      dst[idx + 1] = value;
      dst[idx + 2] = value;
      dst[idx + 3] = 255;
    }
    this._previewCanvas.width = w;
    this._previewCanvas.height = h;
    const ctx = this._previewCanvas.getContext('2d');
    ctx.putImageData(preview, 0, 0);
    this._applyPreviewScale();
  }

  _applyPreviewScale() {
    const canvas = this._previewCanvas;
    if (!canvas || !this._imageData) return;
    const scale = document.querySelector('input[name="img-preview-scale"]:checked')?.value ?? '1x';
    const w = this._imageData.width;
    const h = this._imageData.height;

    // Reset
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
    canvas.classList.remove('fill-view');

    if (scale === '2x') {
      canvas.style.width = `${w * 2}px`;
      canvas.style.height = `${h * 2}px`;
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
    } else if (scale === '4x') {
      canvas.style.width = `${w * 4}px`;
      canvas.style.height = `${h * 4}px`;
      canvas.style.maxWidth = 'none';
      canvas.style.maxHeight = 'none';
    } else if (scale === 'fill') {
      canvas.classList.add('fill-view');
    }
    // '1x' — default CSS handles it (max-width: 100%, max-height: 256px)
  }

  // ── Conversion ──────────────────────────────────────────────────────────

  _toggleAccordion() {
    if (!this._accordionToggle || !this._accordionContent) return;
    
    const isCollapsed = this._accordionContent.classList.contains('collapsed');
    
    if (isCollapsed) {
      // Expand
      this._accordionContent.classList.remove('collapsed');
      this._accordionToggle.setAttribute('aria-expanded', 'true');
    } else {
      // Collapse
      this._accordionContent.classList.add('collapsed');
      this._accordionToggle.setAttribute('aria-expanded', 'false');
    }
  }

  _updateConversion() {
    if (!this._imageData) return;

    const format = this._formatSelect?.value || OUTPUT_FORMAT.SPRITES_OVERWRITE;
    const name = this._sanitizeName(this._varnameInput?.value || 'image');
    const fw = parseInt(this._frameWidthInput?.value, 10) || 0;
    const fh = parseInt(this._frameHeightInput?.value, 10) || 0;
    const spacing = parseInt(this._spacingInput?.value, 10) || 0;
    const threshold = parseInt(this._thresholdSlider?.value, 10) ?? 128;

    const isLegacy = format === OUTPUT_FORMAT.DRAW_BITMAP || format === OUTPUT_FORMAT.DRAW_SLOW_XY;
    const manualOffset = this._manualOffsetCb?.checked ?? true;

    // Compute natural (unlimited) frame count for warning/notice display
    const imgW = this._imageData.width;
    const imgH = this._imageData.height;
    const eFw = fw || imgW;
    const eFh = fh || imgH;
    this._naturalFrameCount = Math.max(1, Math.floor((imgW + spacing) / (eFw + spacing)))
      * Math.max(1, Math.floor((imgH + spacing) / (eFh + spacing)));

    const config = {
      format, width: fw, height: fh, spacing, threshold,
      ...(isLegacy && !manualOffset ? { maxFrames: 1 } : {}),
    };

    try {
      this._lastResult = convertImageFormat(this._imageData, name, config);
    } catch (err) {
      showToast(`Conversion error: ${err.message}`, 'error');
      return;
    }

    this._renderOutput();
    this._renderFrameStrip();
  }

  // ── Output rendering ───────────────────────────────────────────────────

  _renderOutput() {
    const r = this._lastResult;
    if (!r) return;

    // Show output groups
    this._outputGroup?.classList.remove('hidden');
    this._usageGroup?.classList.remove('hidden');

    // Code
    if (this._codeOutput) {
      this._codeOutput.textContent = r.code;
    }

    // Info bar
    const format = this._formatSelect?.value;
    const isVertical = format !== OUTPUT_FORMAT.DRAW_SLOW_XY;
    const displayHeight = isVertical ? r.paddedHeight : r.frameHeight;
    const paddedNote = (isVertical && r.paddedHeight !== r.frameHeight)
      ? ` (padded from ${r.frameHeight})`
      : '';

    if (this._outputInfo) {
      this._outputInfo.innerHTML = [
        `<span class="img-info-item">Size: <span class="img-info-value">${r.frameWidth}\u00d7${displayHeight}${paddedNote}</span></span>`,
        `<span class="img-info-item">Frames: <span class="img-info-value">${r.frameCount}</span></span>`,
        `<span class="img-info-item">Bytes: <span class="img-info-value">${r.byteCount.toLocaleString()}</span></span>`,
      ].join('');
    }

    // Frame info text
    if (this._frameInfo) {
      this._frameInfo.textContent = r.frameCount > 1
        ? `${r.frameCount} frames detected (${r.frameWidth}\u00d7${r.frameHeight} each)`
        : `Single frame (${r.frameWidth}\u00d7${r.frameHeight})`;
    }

    // Usage + format compatibility warning
    this._updateUsageDisplay();
    this._updateFormatWarning();
  }

  _updateUsageDisplay() {
    const r = this._lastResult;
    if (!r) return;

    const format = this._formatSelect?.value;
    const name = this._sanitizeName(this._varnameInput?.value || 'image');
    const isVertical = format !== OUTPUT_FORMAT.DRAW_SLOW_XY;
    const displayHeight = isVertical ? r.paddedHeight : r.frameHeight;

    const snippet = generateUsageSnippet(name, format, r.frameWidth, displayHeight, r.frameCount);

    if (this._fullSketchCb?.checked) {
      const fullSketch = generateFullSketch(name, format, r.frameWidth, displayHeight, r.code, snippet, r.frameCount);
      if (this._usageOutput) this._usageOutput.textContent = fullSketch;
    } else {
      if (this._usageOutput) this._usageOutput.textContent = snippet;
    }
  }

  // ── Format compatibility warning ────────────────────────────────────────

  _updateFormatWarning() {
    if (!this._formatWarning) return;
    const format = this._formatSelect?.value;

    const isLegacyFormat = format === OUTPUT_FORMAT.DRAW_BITMAP
      || format === OUTPUT_FORMAT.DRAW_SLOW_XY;
    const naturalMultiFrame = (this._naturalFrameCount ?? 1) > 1;
    const manualOffset = this._manualOffsetCb?.checked ?? true;

      // Show/hide manual offset row only for legacy formats with multiple frames
      this._manualOffsetRow?.classList.toggle('hidden', !(isLegacyFormat && naturalMultiFrame));

    // Show/hide first-frame notice in output section
    if (this._firstFrameNotice) {
      const showNotice = isLegacyFormat && !manualOffset && naturalMultiFrame;
      this._firstFrameNotice.classList.toggle('hidden', !showNotice);
    }

    // Format compatibility warning
    if (isLegacyFormat && naturalMultiFrame) {
      const fname = format === OUTPUT_FORMAT.DRAW_BITMAP ? 'drawBitmap()' : 'drawSlowXYBitmap()';
      if (this._formatWarningText) {
        this._formatWarningText.textContent = `${fname} has no built-in frame index. Switch to\u00a0`;
      }
      if (this._formatSwitchLink) {
        this._formatSwitchLink.textContent = 'Sprites (drawOverwrite)';
        this._formatSwitchLink.dataset.targetFormat = OUTPUT_FORMAT.SPRITES_OVERWRITE;
      }
      this._formatWarning.classList.remove('hidden');
    } else {
      this._formatWarning.classList.add('hidden');
    }
  }

  // ── Frame strip ─────────────────────────────────────────────────────────

  _renderFrameStrip() {
    if (!this._frameStrip || !this._imageData || !this._lastResult) return;
    this._frameStrip.innerHTML = '';

    const r = this._lastResult;
    const imgData = this._imageData;
    const fw = r.frameWidth;
    const fh = r.frameHeight;
    const spacing = parseInt(this._spacingInput?.value, 10) || 0;
    const cols = Math.max(1, Math.floor((imgData.width + spacing) / (fw + spacing)));
    const maxDisplay = Math.min(r.frameCount, 50);

    const stripScale = parseInt(document.querySelector('input[name="img-strip-scale"]:checked')?.value ?? '1', 10);

    for (let i = 0; i < maxDisplay; i++) {
      const frameCol = i % cols;
      const frameRow = Math.floor(i / cols);
      const sx = frameCol * (fw + spacing);
      const sy = frameRow * (fh + spacing);

      const canvas = document.createElement('canvas');
      canvas.width = fw * stripScale;
      canvas.height = fh * stripScale;
      canvas.title = `Frame ${i}`;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      // Draw the frame region from the source image
      const tempCanvas = new OffscreenCanvas(fw, fh);
      const tempCtx = tempCanvas.getContext('2d');

      // Copy pixel region from imageData
      const frameData = new ImageData(fw, fh);
      const src = imgData.data;
      const dst = frameData.data;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const srcIdx = ((sy + y) * imgData.width + (sx + x)) * 4;
          const dstIdx = (y * fw + x) * 4;
          if (sx + x < imgData.width && sy + y < imgData.height) {
            dst[dstIdx] = src[srcIdx];
            dst[dstIdx + 1] = src[srcIdx + 1];
            dst[dstIdx + 2] = src[srcIdx + 2];
            dst[dstIdx + 3] = src[srcIdx + 3];
          }
        }
      }
      tempCtx.putImageData(frameData, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, fw * stripScale, fh * stripScale);

      this._frameStrip.appendChild(canvas);
    }

    if (this._frameMore) {
      if (r.frameCount > maxDisplay) {
        this._frameMore.textContent = `\u2026 and ${r.frameCount - maxDisplay} more frames`;
        this._frameMore.classList.remove('hidden');
      } else {
        this._frameMore.textContent = '';
        this._frameMore.classList.add('hidden');
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _extractBytesOnly(code) {
    // Extract all 0xNN hex values from the code string, formatted 12 per line
    const hex = [];
    const re = /0x[0-9a-fA-F]{2}/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      hex.push(m[0]);
    }
    const lines = [];
    for (let i = 0; i < hex.length; i += 12) {
      lines.push(hex.slice(i, i + 12).join(', '));
    }
    return lines.join(',\n');
  }

  _sanitizeName(raw) {
    let name = raw.replace(/[^a-zA-Z0-9_]/g, '_');
    // Ensure starts with letter or underscore
    if (name && /^[0-9]/.test(name)) name = '_' + name;
    return name || 'image';
  }
}
