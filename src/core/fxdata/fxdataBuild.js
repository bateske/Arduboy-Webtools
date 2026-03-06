/**
 * FX Data Build Orchestrator.
 *
 * Takes an FxDataProject, parses the entry file, resolves all assets,
 * and emits the complete set of build outputs:
 *   - fxdata.h  (C++ header with constants and symbols)
 *   - fxdata-data.bin (raw data section)
 *   - fxdata-save.bin (raw save section, if present)
 *   - fxdata.bin (dev binary: data padded + save padded)
 */

import { parseFxData } from './fxdataParser.js';
import { encodeFxImage, loadImageFromBytes } from './fxdataImageEncoder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BuildOptions
 * @property {number} [threshold=128] - Image brightness threshold
 * @property {string} [toolVersion='1.0'] - Version string for header comment
 */

/**
 * @typedef {Object} BuildResult
 * @property {boolean} success
 * @property {Uint8Array} dataBin - fxdata-data.bin (raw data section)
 * @property {Uint8Array | null} saveBin - fxdata-save.bin (raw save section)
 * @property {Uint8Array} devBin - fxdata.bin (padded dev binary)
 * @property {string} header - fxdata.h content
 * @property {import('./fxdataParser.js').Diagnostic[]} diagnostics
 * @property {import('./fxdataParser.js').MemoryMapEntry[]} memoryMap
 * @property {{ name: string, offset: number }[]} symbols
 * @property {number} dataSize
 * @property {number} saveSize
 * @property {number} dataPages
 * @property {number} savePages
 * @property {number} fxDataPage
 * @property {number | null} fxSavePage
 */

// ---------------------------------------------------------------------------
// Build function
// ---------------------------------------------------------------------------

/**
 * Build FX data from a project.
 *
 * @param {import('./fxdataProject.js').FxDataProject} project
 * @param {string} entryFile - Path to the entry fxdata.txt within the project
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 */
export async function buildFxData(project, entryFile, options = {}) {
  const threshold = options.threshold ?? 128;
  const toolVersion = options.toolVersion ?? '1.0';

  // Get entry file content
  const sourceText = project.getTextFile(entryFile);
  if (sourceText === undefined) {
    return {
      success: false,
      dataBin: new Uint8Array(0),
      saveBin: null,
      devBin: new Uint8Array(0),
      header: '',
      diagnostics: [{
        severity: 'error',
        message: `Entry file not found: ${entryFile}`,
        file: entryFile,
        line: 0,
      }],
      memoryMap: [],
      symbols: [],
      dataSize: 0,
      saveSize: 0,
      dataPages: 0,
      savePages: 0,
      fxDataPage: 0,
      fxSavePage: null,
    };
  }

  // Set up callbacks for the parser
  const callbacks = {
    /**
     * Resolve an include directive.
     */
    resolveInclude(includePath, fromFile) {
      const resolved = project.resolvePath(includePath, fromFile);
      return project.getTextFile(resolved) ?? null;
    },

    /**
     * Resolve an image_t reference.
     */
    async resolveImage(imagePath, fromFile, opts) {
      const resolved = project.resolvePath(imagePath, fromFile);
      const imageBytes = project.getBinaryFile(resolved);
      if (!imageBytes) {
        throw new Error(`Image file not found: ${imagePath} (resolved to ${resolved})`);
      }
      const imageData = await loadImageFromBytes(imageBytes);
      // Use the filename part for dimension parsing
      const filename = resolved.split('/').pop();
      return encodeFxImage(imageData, filename, {
        threshold: opts.threshold ?? threshold,
      });
    },

    /**
     * Resolve a raw_t reference.
     */
    resolveRaw(rawPath, fromFile) {
      const resolved = project.resolvePath(rawPath, fromFile);
      return project.getBinaryFile(resolved) ?? null;
    },
  };

  // Run the parser
  const result = await parseFxData(sourceText, entryFile, callbacks, { threshold });

  // Check for hard errors
  const hasErrors = result.diagnostics.some((d) => d.severity === 'error');

  // Calculate sizes and pages
  const bytes = result.bytes;
  const saveStart = result.saveStart;

  let dataSize, saveSize;
  if (saveStart >= 0) {
    dataSize = saveStart;
    saveSize = bytes.length - saveStart;
  } else {
    dataSize = bytes.length;
    saveSize = 0;
  }

  const dataPages = Math.ceil(dataSize / 256) || 0;
  const savePages = saveSize > 0 ? Math.ceil(saveSize / 4096) * 16 : 0;
  const dataPadding = dataPages * 256 - dataSize;
  const savePadding = savePages * 256 - saveSize;

  const fxDataPage = 65536 - dataPages - savePages;
  const fxSavePage = saveSize > 0 ? 65536 - savePages : null;

  // Generate fxdata.h
  const header = generateHeader(
    result.headerLines,
    fxDataPage,
    dataSize,
    fxSavePage,
    saveSize,
    toolVersion,
  );

  // Generate binary outputs
  const dataBin = bytes.slice(0, dataSize);

  let saveBin = null;
  if (saveSize > 0) {
    saveBin = bytes.slice(saveStart, bytes.length);
  }

  // Dev binary: data padded to page boundary + save padded to 4KB block boundary
  const devParts = [dataBin];
  if (dataPadding > 0) {
    devParts.push(new Uint8Array(dataPadding).fill(0xFF));
  }
  if (saveSize > 0) {
    devParts.push(saveBin);
    if (savePadding > 0) {
      devParts.push(new Uint8Array(savePadding).fill(0xFF));
    }
  }
  const devBin = concatArrays(devParts);

  return {
    success: !hasErrors,
    dataBin,
    saveBin,
    devBin,
    header,
    diagnostics: result.diagnostics,
    memoryMap: result.memoryMap,
    symbols: result.symbols,
    dataSize,
    saveSize,
    dataPages,
    savePages,
    fxDataPage,
    fxSavePage,
  };
}

// ---------------------------------------------------------------------------
// Header generation
// ---------------------------------------------------------------------------

/**
 * Generate the fxdata.h header file content.
 *
 * @param {string[]} bodyLines - Symbol definitions and namespace blocks
 * @param {number} fxDataPage
 * @param {number} dataSize
 * @param {number|null} fxSavePage
 * @param {number} saveSize
 * @param {string} toolVersion
 * @returns {string}
 */
function generateHeader(bodyLines, fxDataPage, dataSize, fxSavePage, saveSize, toolVersion) {
  const lines = [];
  lines.push('#pragma once');
  lines.push('');
  lines.push(`/**** FX data header generated by Arduboy Web Tools version ${toolVersion} ****/`);
  lines.push('');
  lines.push('using uint24_t = __uint24;');
  lines.push('');
  lines.push('// Initialize FX hardware using  FX::begin(FX_DATA_PAGE); in the setup() function.');
  lines.push('');
  lines.push(`constexpr uint16_t FX_DATA_PAGE  = 0x${fxDataPage.toString(16).padStart(4, '0')};`);
  lines.push(`constexpr uint24_t FX_DATA_BYTES = ${dataSize};`);
  lines.push('');

  if (fxSavePage !== null && saveSize > 0) {
    lines.push(`constexpr uint16_t FX_SAVE_PAGE  = 0x${fxSavePage.toString(16).padStart(4, '0')};`);
    lines.push(`constexpr uint24_t FX_SAVE_BYTES = ${saveSize};`);
    lines.push('');
  }

  for (const line of bodyLines) {
    lines.push(line);
  }

  // Ensure trailing newline
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Concatenate multiple Uint8Arrays.
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
function concatArrays(arrays) {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
