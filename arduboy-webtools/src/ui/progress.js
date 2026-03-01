/**
 * Progress modal controller.
 * Manages the overlay that displays during long-running device operations.
 */

export class ProgressController {
  /**
   * @param {HTMLElement} overlay - The `.modal-overlay` element.
   * @param {HTMLElement} bar - The `.progress-bar` element within.
   * @param {HTMLElement} statusEl - The `.progress-status` text element.
   * @param {HTMLElement} percentEl - The `.progress-percent` text element.
   * @param {HTMLElement} titleEl - The progress card title element.
   */
  constructor(overlay, bar, statusEl, percentEl, titleEl) {
    this.overlay = overlay;
    this.bar = bar;
    this.statusEl = statusEl;
    this.percentEl = percentEl;
    this.titleEl = titleEl;
  }

  /**
   * Show the progress modal, resetting to 0%.
   * @param {string} [title='Working...'] - Modal title text.
   */
  show(title = 'Working...') {
    this.titleEl.textContent = title;
    this.update(0, 'Initializing...');
    this.overlay.classList.remove('hidden');
  }

  /**
   * Update progress bar and status text.
   * @param {number} percent - 0 to 100.
   * @param {string} [statusText] - Optional status message.
   */
  update(percent, statusText) {
    if (typeof percent === 'number' && !Number.isNaN(percent)) {
      const clamped = Math.max(0, Math.min(100, percent));
      this.bar.style.width = `${clamped}%`;
      this.percentEl.textContent = `${Math.round(clamped)}%`;
    }
    if (statusText !== undefined) {
      this.statusEl.textContent = statusText;
    }
  }

  /** Hide the progress modal. */
  hide() {
    this.overlay.classList.add('hidden');
  }

  /**
   * Show 100% complete, wait for the CSS transition to render, then hide.
   * @param {string} [statusText='Complete!'] - Final status message.
   * @param {number} [delay=300] - ms to hold at 100% before hiding.
   * @returns {Promise<void>}
   */
  async finish(statusText = 'Complete!', delay = 300) {
    this.update(100, statusText);
    await new Promise((r) => setTimeout(r, delay));
    this.hide();
  }

  /**
   * Create a progress callback suitable for passing to core operations.
   * Returns a function `(percent, message) => void`.
   * @returns {(percent: number, message?: string) => void}
   */
  callback() {
    return (percent, message) => this.update(percent, message);
  }
}
