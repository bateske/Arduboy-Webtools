/**
 * File input helper utilities.
 */

/**
 * Read a File object as an ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read a File object as text.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Trigger a browser download of binary data.
 * @param {Uint8Array|ArrayBuffer} data
 * @param {string} filename
 * @param {string} [mimeType='application/octet-stream']
 */
export function downloadBlob(data, filename, mimeType = 'application/octet-stream') {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

/**
 * Set up a panel as a drag-and-drop target.
 * Creates a visual overlay and fires a callback when matching files are dropped.
 *
 * @param {HTMLElement} panel       - The panel element (section.panel)
 * @param {Object}      opts
 * @param {string[]}    opts.extensions   - Accepted file extensions (e.g. ['.hex', '.arduboy'])
 * @param {string}      opts.label        - Drop zone label (e.g. 'Drop .hex file here')
 * @param {(file: File) => void} opts.onDrop - Callback when a valid file is dropped
 */
export function setupPanelDrop(panel, { extensions, label, onDrop }) {
  if (!panel) return;

  // Create overlay element
  const overlay = document.createElement('div');
  overlay.className = 'panel-drop-overlay';
  overlay.innerHTML = `
    <div class="drop-overlay-content">
      <span class="drop-overlay-icon">&#x1F4E5;</span>
      <span>${label}</span>
      <span class="drop-overlay-hint">${extensions.join(', ')} files accepted</span>
    </div>
  `;
  panel.appendChild(overlay);

  let dragCounter = 0;

  panel.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    panel.classList.add('drop-active');
  });

  panel.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  panel.addEventListener('dragleave', (e) => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      panel.classList.remove('drop-active');
    }
  });

  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    panel.classList.remove('drop-active');

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Find first file matching an accepted extension
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (extensions.some((ext) => name.endsWith(ext))) {
        onDrop(file);
        return;
      }
    }
  });
}

/**
 * Wire up a file input + label so the label displays the chosen filename.
 * @param {HTMLInputElement} input - The `<input type="file">` element.
 * @param {HTMLElement} label - The `.file-input-label` element.
 * @param {(file: File) => void} [onChange] - Callback when a file is selected.
 */
export function wireFileInput(input, label, onChange) {
  const defaultText = label.textContent;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      const nameSpan = label.querySelector('.file-name') || label;
      nameSpan.textContent = file.name;
      label.classList.add('has-file');
      onChange?.(file);
    } else {
      label.textContent = defaultText;
      label.classList.remove('has-file');
    }
  });
}
