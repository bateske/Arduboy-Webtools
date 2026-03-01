/**
 * .arduboy package format (ZIP) reader and writer.
 *
 * Handles all schema versions (v2, v3, v4) with backward compatibility.
 *
 * Ported from: arduboy_toolset/arduboy/arduhex.py
 */

import JSZip from 'jszip';
import { ARDUBOY_SCHEMA_VERSION } from '../constants.js';

// =============================================================================
// Data Structures
// =============================================================================

/**
 * @typedef {Object} ArduboyBinary
 * @property {string} device - "Arduboy", "ArduboyFX", or "ArduboyMini"
 * @property {string} title - Binary title
 * @property {string} hexFilename - Hex file name within ZIP
 * @property {string} hexRaw - Intel HEX format string
 * @property {Uint8Array} dataRaw - FX data blob
 * @property {Uint8Array} saveRaw - FX save blob
 * @property {ImageBitmap|null} cartImage - Cart title screen image
 * @property {string} cartImageFilename - Cart image filename within ZIP
 */

/**
 * @typedef {Object} ArduboyContributor
 * @property {string} name
 * @property {string[]} roles
 * @property {string[]} urls
 */

/**
 * @typedef {Object} ArduboyPackage
 * @property {string} originalFilename
 * @property {number} schemaVersion
 * @property {string} title
 * @property {string} version
 * @property {string} author
 * @property {string} description
 * @property {string} license
 * @property {string} date
 * @property {string} genre
 * @property {string} url
 * @property {string} sourceUrl
 * @property {string} email
 * @property {string} companion
 * @property {ArduboyContributor[]} contributors
 * @property {ArduboyBinary[]} binaries
 */

// =============================================================================
// Read
// =============================================================================

/**
 * Read and parse an .arduboy file (ZIP archive).
 *
 * @param {File|Blob|ArrayBuffer} fileData - The .arduboy file contents
 * @param {string} [filename='unknown.arduboy'] - Original filename
 * @returns {Promise<ArduboyPackage>}
 */
export async function readArduboyFile(fileData, filename = 'unknown.arduboy') {
  const zip = await JSZip.loadAsync(fileData);

  // Read info.json (required)
  const infoFile = zip.file('info.json');
  if (!infoFile) {
    throw new Error('Invalid .arduboy file: missing info.json');
  }

  const infoText = await infoFile.async('string');
  const info = JSON.parse(fixJSON(infoText));

  const schemaVersion = info.schemaVersion || 2;

  // Parse contributors (handle v2/v3 → v4 upgrade)
  const contributors = parseContributors(info);

  // Pre-load a fallback image: try cart.png, then banner field, then any .png in ZIP
  let fallbackImageBlob = null;
  const fallbackCandidates = ['cart.png'];
  if (info.banner) fallbackCandidates.push(info.banner);
  for (const candidate of fallbackCandidates) {
    const file = findFileInZip(zip, candidate);
    if (file) {
      const blob = await file.async('blob');
      try {
        await createImageBitmap(blob); // validate it's a real image
        fallbackImageBlob = blob;
        break;
      } catch { /* not a valid image */ }
    }
  }
  // Last resort: find any .png file in the ZIP
  if (!fallbackImageBlob) {
    for (const [path, entry] of Object.entries(zip.files)) {
      if (!entry.dir && path.toLowerCase().endsWith('.png')) {
        const blob = await entry.async('blob');
        try {
          await createImageBitmap(blob);
          fallbackImageBlob = blob;
          break;
        } catch { /* skip */ }
      }
    }
  }

  // Parse binaries
  const binaries = [];
  const binaryList = info.binaries || [];

  for (const bin of binaryList) {
    const hexFilename = bin.filename || '';
    let hexRaw = '';
    let dataRaw = new Uint8Array(0);
    let saveRaw = new Uint8Array(0);
    let cartImage = null;
    let cartImageFilename = '';

    // Extract hex file
    if (hexFilename) {
      const hexFile = findFileInZip(zip, hexFilename);
      if (hexFile) {
        hexRaw = await hexFile.async('string');
      }
    }

    // Extract FX data
    const dataFilename = bin.flashdata || bin.datafile || '';
    if (dataFilename) {
      const dataFile = findFileInZip(zip, dataFilename);
      if (dataFile) {
        dataRaw = new Uint8Array(await dataFile.async('arraybuffer'));
      }
    }

    // Extract FX save
    const saveFilename = bin.flashsave || bin.savefile || '';
    if (saveFilename) {
      const saveFile = findFileInZip(zip, saveFilename);
      if (saveFile) {
        saveRaw = new Uint8Array(await saveFile.async('arraybuffer'));
      }
    }

    // Extract cart image — handle all known field names:
    //   cartImage (camelCase, our writer), cartimage (lowercase, toolset), image (legacy)
    let cartImageBlob = null;
    cartImageFilename = bin.cartImage || bin.cartimage || bin.image || '';
    if (cartImageFilename) {
      const imageFile = findFileInZip(zip, cartImageFilename);
      if (imageFile) {
        const imageBlob = await imageFile.async('blob');
        try {
          cartImage = await createImageBitmap(imageBlob);
          cartImageBlob = imageBlob;
        } catch {
          // Image decode failed — leave null
        }
      }
    }

    // Fallback: use the pre-loaded fallback image (cart.png, banner, or any .png)
    if (!cartImageBlob && fallbackImageBlob) {
      try {
        cartImage = await createImageBitmap(fallbackImageBlob);
        cartImageBlob = fallbackImageBlob;
        cartImageFilename = 'cart.png';
      } catch {
        // ignore
      }
    }

    binaries.push({
      device: bin.device || 'Arduboy',
      title: bin.title || info.title || '',
      hexFilename,
      hexRaw,
      dataRaw,
      saveRaw,
      cartImage,
      cartImageFilename,
      cartImageBlob,
    });
  }

  return {
    originalFilename: filename,
    schemaVersion,
    title: info.title || '',
    version: info.version || '',
    author: info.author || '',
    description: info.description || '',
    license: info.license || '',
    date: info.date || '',
    genre: info.genre || '',
    url: info.url || '',
    sourceUrl: info.sourceUrl || '',
    email: info.email || '',
    companion: info.companion || '',
    contributors,
    binaries,
  };
}

// =============================================================================
// Write
// =============================================================================

/**
 * Write an ArduboyPackage to a .arduboy file (ZIP archive).
 * Always writes as schema v4.
 *
 * @param {ArduboyPackage} pkg - Package to write
 * @returns {Promise<Blob>} ZIP file as Blob, ready for download
 */
export async function writeArduboyFile(pkg) {
  const zip = new JSZip();

  // Build info.json
  const info = {
    schemaVersion: ARDUBOY_SCHEMA_VERSION,
    title: pkg.title,
    description: pkg.description,
    author: pkg.author,
    version: pkg.version,
    date: pkg.date,
    genre: pkg.genre,
    license: pkg.license,
    url: pkg.url,
    sourceUrl: pkg.sourceUrl,
    email: pkg.email,
    companion: pkg.companion,
    contributors: pkg.contributors.map((c) => ({
      name: c.name,
      roles: c.roles,
      urls: c.urls,
    })),
    binaries: pkg.binaries.map((b) => {
      const entry = {
        title: b.title,
        filename: b.hexFilename,
        device: b.device,
      };
      if (b.dataRaw && b.dataRaw.length > 0) {
        entry.flashdata = getDataFilename(b.hexFilename);
      }
      if (b.saveRaw && b.saveRaw.length > 0) {
        entry.flashsave = getSaveFilename(b.hexFilename);
      }
      if (b.cartImageFilename) {
        entry.cartImage = b.cartImageFilename;
      }
      return entry;
    }),
  };

  zip.file('info.json', JSON.stringify(info, null, 2));

  // Add binary files
  for (const bin of pkg.binaries) {
    if (bin.hexRaw) {
      zip.file(bin.hexFilename, bin.hexRaw);
    }
    if (bin.dataRaw && bin.dataRaw.length > 0) {
      zip.file(getDataFilename(bin.hexFilename), bin.dataRaw);
    }
    if (bin.saveRaw && bin.saveRaw.length > 0) {
      zip.file(getSaveFilename(bin.hexFilename), bin.saveRaw);
    }
    // Write cart image blob/arraybuffer if provided
    if (bin.cartImageBlob) {
      zip.file(bin.cartImageFilename, bin.cartImageBlob);
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Fix common JSON issues in .arduboy info.json files.
 * Removes trailing commas before ] and }.
 *
 * @param {string} jsonString
 * @returns {string} Fixed JSON string
 */
export function fixJSON(jsonString) {
  return jsonString.replace(/,\s*([\]}])/g, '$1');
}

/**
 * Find a file in a ZIP archive (case-insensitive).
 * @param {JSZip} zip
 * @param {string} filename
 * @returns {JSZip.JSZipObject|null}
 */
function findFileInZip(zip, filename) {
  // Try exact match first
  let file = zip.file(filename);
  if (file) return file;

  // Case-insensitive search
  const lower = filename.toLowerCase();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path.toLowerCase() === lower || path.toLowerCase().endsWith('/' + lower)) {
      return entry;
    }
  }
  return null;
}

/**
 * Parse contributors from info.json, handling all schema versions.
 * v2/v3 used flat keys: publisher, code, art, sound
 * v4 uses structured contributors array
 */
function parseContributors(info) {
  if (info.contributors && Array.isArray(info.contributors)) {
    return info.contributors.map((c) => ({
      name: c.name || '',
      roles: c.roles || [],
      urls: c.urls || [],
    }));
  }

  // Legacy schema: merge credit fields
  const contributors = [];
  const roleMap = {
    publisher: 'Publisher',
    code: 'Code',
    art: 'Art',
    sound: 'Sound',
  };

  for (const [key, role] of Object.entries(roleMap)) {
    if (info[key]) {
      const name = info[key];
      const existing = contributors.find((c) => c.name === name);
      if (existing) {
        existing.roles.push(role);
      } else {
        contributors.push({ name, roles: [role], urls: [] });
      }
    }
  }

  return contributors;
}

/**
 * Generate a data filename from a hex filename.
 * @param {string} hexFilename
 * @returns {string}
 */
function getDataFilename(hexFilename) {
  return hexFilename.replace(/\.hex$/i, '-data.bin');
}

/**
 * Generate a save filename from a hex filename.
 * @param {string} hexFilename
 * @returns {string}
 */
function getSaveFilename(hexFilename) {
  return hexFilename.replace(/\.hex$/i, '-save.bin');
}
