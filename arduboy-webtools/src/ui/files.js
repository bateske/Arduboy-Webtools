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
