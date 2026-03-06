/**
 * Virtual in-memory project filesystem for FX data projects.
 *
 * Stores all project files (text sources, images, binaries) in memory
 * so the browser-based editor can work without a real filesystem.
 */

import JSZip from 'jszip';

/** @typedef {{ name: string, data: string | Uint8Array, lastModified: number }} ProjectFile */

const TEXT_EXTENSIONS = new Set(['.txt', '.h', '.c', '.cpp', '.ino', '.json', '.csv', '.md']);
const IMAGE_EXTENSIONS = new Set(['.png', '.bmp', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * Normalize a file path: forward slashes, no leading slash, collapse . and ..
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  let clean = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (clean.startsWith('/')) clean = clean.slice(1);
  // Collapse . and ..
  const parts = [];
  for (const seg of clean.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..' && parts.length > 0) { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Get the file extension (lowercase, including the dot).
 * @param {string} path
 * @returns {string}
 */
function extOf(path) {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

export class FxDataProject {
  constructor() {
    /** @type {Map<string, ProjectFile>} */
    this._files = new Map();
  }

  // ---------------------------------------------------------------------------
  // Basic operations
  // ---------------------------------------------------------------------------

  /**
   * Add or update a file in the project.
   * @param {string} path - Relative path (will be normalized)
   * @param {string | Uint8Array} data
   */
  addFile(path, data) {
    const key = normalizePath(path);
    const name = key.split('/').pop();
    this._files.set(key, { name, data, lastModified: Date.now() });
  }

  /**
   * Get a file entry by path.
   * @param {string} path
   * @returns {ProjectFile | undefined}
   */
  getFile(path) {
    return this._files.get(normalizePath(path));
  }

  /**
   * Get file content as a string. Returns undefined if not found.
   * @param {string} path
   * @returns {string | undefined}
   */
  getTextFile(path) {
    const f = this.getFile(path);
    if (!f) return undefined;
    if (typeof f.data === 'string') return f.data;
    return new TextDecoder().decode(f.data);
  }

  /**
   * Get file content as Uint8Array. Returns undefined if not found.
   * @param {string} path
   * @returns {Uint8Array | undefined}
   */
  getBinaryFile(path) {
    const f = this.getFile(path);
    if (!f) return undefined;
    if (f.data instanceof Uint8Array) return f.data;
    return new TextEncoder().encode(f.data);
  }

  /**
   * Remove a file.
   * @param {string} path
   * @returns {boolean} true if the file existed and was removed
   */
  removeFile(path) {
    return this._files.delete(normalizePath(path));
  }

  /**
   * Check if a file exists.
   * @param {string} path
   * @returns {boolean}
   */
  hasFile(path) {
    return this._files.has(normalizePath(path));
  }

  /**
   * List all file paths (sorted).
   * @returns {string[]}
   */
  listFiles() {
    return [...this._files.keys()].sort();
  }

  /**
   * List files matching a given extension.
   * @param {string} ext - Extension including dot, e.g. '.png'
   * @returns {string[]}
   */
  listByExtension(ext) {
    const lower = ext.toLowerCase();
    return this.listFiles().filter((p) => extOf(p) === lower);
  }

  /** Clear all files from the project. */
  clear() {
    this._files.clear();
  }

  /** @returns {number} Number of files in the project. */
  get size() {
    return this._files.size;
  }

  // ---------------------------------------------------------------------------
  // Resolve a path relative to another file (for include directives)
  // ---------------------------------------------------------------------------

  /**
   * Resolve a relative path from the directory containing `fromFile`.
   * @param {string} relativePath - The path to resolve
   * @param {string} fromFile - The file containing the include directive
   * @returns {string} Normalized absolute project path
   */
  resolvePath(relativePath, fromFile) {
    const dir = normalizePath(fromFile).split('/').slice(0, -1).join('/');
    const combined = dir ? `${dir}/${relativePath}` : relativePath;
    return normalizePath(combined);
  }

  // ---------------------------------------------------------------------------
  // Bulk import / export
  // ---------------------------------------------------------------------------

  /**
   * Import files from a ZIP blob.
   * @param {Blob | ArrayBuffer | Uint8Array} zipData
   */
  async importFromZip(zipData) {
    const zip = await JSZip.loadAsync(zipData);
    const entries = [];
    zip.forEach((path, entry) => {
      if (!entry.dir) entries.push({ path, entry });
    });

    // Strip a common single-segment root prefix if all files share one.
    // e.g. all files under "myproject/" → strip "myproject/"
    let prefix = '';
    if (entries.length > 0) {
      const firstSeg = (p) => {
        const slash = p.indexOf('/');
        return slash === -1 ? '' : p.slice(0, slash + 1);
      };
      const candidate = firstSeg(entries[0].path);
      if (candidate && entries.every((e) => e.path.startsWith(candidate))) {
        prefix = candidate;
      }
    }

    for (const { path, entry } of entries) {
      const storePath = prefix ? path.slice(prefix.length) : path;
      if (!storePath) continue; // skip the root folder entry itself
      const ext = extOf(storePath);
      if (TEXT_EXTENSIONS.has(ext)) {
        const text = await entry.async('string');
        this.addFile(storePath, text);
      } else {
        const bytes = await entry.async('uint8array');
        this.addFile(storePath, bytes);
      }
    }
  }

  /**
   * Export the entire project as a ZIP blob.
   * @returns {Promise<Blob>}
   */
  async exportToZip() {
    const zip = new JSZip();
    for (const [path, file] of this._files) {
      zip.file(path, file.data);
    }
    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * Import from a FileList (drag-drop or file picker).
   * @param {FileList | File[]} fileList
   */
  async importFromFiles(fileList) {
    for (const file of fileList) {
      // Use webkitRelativePath if available (folder upload), else just name
      const path = file.webkitRelativePath || file.name;
      const ext = extOf(path);

      if (TEXT_EXTENSIONS.has(ext)) {
        const text = await file.text();
        this.addFile(path, text);
      } else {
        const buffer = await file.arrayBuffer();
        this.addFile(path, new Uint8Array(buffer));
      }
    }
  }

  /**
   * Import a single image file and return its project path.
   * @param {File} file
   * @returns {Promise<string>} The path where the file was stored
   */
  async importImageFile(file) {
    const path = file.webkitRelativePath || file.name;
    const buffer = await file.arrayBuffer();
    this.addFile(path, new Uint8Array(buffer));
    return normalizePath(path);
  }

  // ---------------------------------------------------------------------------
  // Serialization for localStorage persistence
  // ---------------------------------------------------------------------------

  /**
   * Serialize the project to a JSON-safe object.
   * Binary data is stored as base64.
   * @returns {Object}
   */
  serialize() {
    const files = {};
    for (const [path, file] of this._files) {
      if (typeof file.data === 'string') {
        files[path] = { type: 'text', data: file.data, lastModified: file.lastModified };
      } else {
        // Convert Uint8Array to base64
        let binary = '';
        for (let i = 0; i < file.data.length; i++) {
          binary += String.fromCharCode(file.data[i]);
        }
        files[path] = { type: 'binary', data: btoa(binary), lastModified: file.lastModified };
      }
    }
    return files;
  }

  /**
   * Restore project from a serialized object.
   * @param {Object} data - Output of serialize()
   */
  deserialize(data) {
    this.clear();
    for (const [path, entry] of Object.entries(data)) {
      if (entry.type === 'text') {
        this.addFile(path, entry.data);
      } else {
        const binary = atob(entry.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        this.addFile(path, bytes);
      }
    }
  }
}
