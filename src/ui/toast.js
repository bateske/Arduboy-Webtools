/**
 * Toast notification system for user feedback.
 */

/** @type {HTMLDivElement|null} */
let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message - The message text.
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - Toast style.
 * @param {number} [duration=3000] - Auto-dismiss time in ms.
 */
export function showToast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, duration);
}
