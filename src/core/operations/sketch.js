/**
 * Sketch (internal flash) operations.
 *
 * Upload, verify, backup, and erase the ATmega32U4 application flash.
 *
 * Ported from:
 *   - Arduboy-Python-Utilities/uploader.py
 *   - arduboy_toolset/arduboy/serial.py (flash_arduhex, verify_arduhex, backup_sketch)
 *   - ArduboyWebFlasher flashHex()
 */

import { FLASH_PAGESIZE, FLASH_SIZE, FLASH_PAGES, MEM_TYPE, LED_PRESET } from '../constants.js';
import { parseIntelHex } from '../formats/intelhex.js';
import { arraysEqual } from '../utils/binary.js';

/**
 * @typedef {Object} SketchAnalysis
 * @property {number} totalPages - Total pages containing data
 * @property {number} dataLength - Highest address with data + 1
 * @property {boolean} overwritesCaterina - Data extends into Caterina bootloader region (page ≥ 224)
 * @property {boolean} overwritesCathy - Data extends into Cathy3K bootloader region (page ≥ 232)
 * @property {Uint8Array} data - The 32KB binary data
 * @property {boolean[]} pageUsed - Which pages contain data
 */

/**
 * Analyze a hex string or binary data for upload safety.
 *
 * @param {string|Uint8Array} input - Intel HEX string or raw binary
 * @returns {SketchAnalysis}
 */
export function analyzeSketch(input) {
  let data, pageUsed, dataLength;

  if (typeof input === 'string') {
    const parsed = parseIntelHex(input);
    data = parsed.data;
    pageUsed = parsed.pageUsed;
    dataLength = parsed.dataLength;
  } else {
    data = input;
    pageUsed = new Array(FLASH_PAGES).fill(false);
    dataLength = data.length;
    for (let page = 0; page < FLASH_PAGES; page++) {
      const start = page * FLASH_PAGESIZE;
      for (let i = start; i < start + FLASH_PAGESIZE && i < data.length; i++) {
        if (data[i] !== 0xff) {
          pageUsed[page] = true;
          break;
        }
      }
    }
  }

  const totalPages = pageUsed.filter(Boolean).length;
  const caterinaBoundary = 224; // 28KB / 128 = page 224
  const cathyBoundary = 232;   // 29KB / 128 = page ~232

  const overwritesCaterina = pageUsed.slice(caterinaBoundary).some(Boolean);
  const overwritesCathy = pageUsed.slice(cathyBoundary).some(Boolean);

  return {
    totalPages,
    dataLength,
    overwritesCaterina,
    overwritesCathy,
    data,
    pageUsed,
  };
}

/**
 * Upload a sketch (hex file) to the Arduboy's internal flash.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol - Connected protocol
 * @param {string} hexData - Intel HEX format string
 * @param {Object} [options]
 * @param {boolean} [options.verify=true] - Verify after writing
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @param {Function} [options.onStatus] - Status message callback
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function uploadSketch(protocol, hexData, { verify = true, onProgress, onStatus } = {}) {
  const analysis = analyzeSketch(hexData);

  if (analysis.totalPages === 0) {
    return { success: false, message: 'No data to write — hex file is empty.' };
  }

  // Safety check: don't overwrite bootloader
  // Disabled — Cathy3K bootloader protects itself in hardware/software
  // if (analysis.overwritesCaterina) {
  //   return { success: false, message: 'Hex data extends into bootloader region. Upload aborted for safety.' };
  // }

  onStatus?.('Writing sketch...');
  // setLed is a Cathy3K extension — non-fatal if unsupported
  try { await protocol.setLed(LED_PRESET.RED_LOCKED); } catch { /* ignore on Caterina */ }

  // Write all used pages
  let pagesWritten = 0;
  for (let page = 0; page < FLASH_PAGES; page++) {
    if (!analysis.pageUsed[page]) continue;

    const pageData = analysis.data.slice(page * FLASH_PAGESIZE, (page + 1) * FLASH_PAGESIZE);
    await protocol.writeFlashPage(page, pageData);

    pagesWritten++;
    onProgress?.(pagesWritten / (analysis.totalPages * (verify ? 2 : 1)));
  }

  // Verify
  if (verify) {
    onStatus?.('Verifying sketch...');
    try { await protocol.setLed(LED_PRESET.BLUE_LOCKED); } catch { /* ignore */ }

    let pagesVerified = 0;
    for (let page = 0; page < FLASH_PAGES; page++) {
      if (!analysis.pageUsed[page]) continue;

      const expected = analysis.data.slice(page * FLASH_PAGESIZE, (page + 1) * FLASH_PAGESIZE);
      const actual = await protocol.readFlashPage(page);

      if (!arraysEqual(expected, actual)) {
        try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }
        return {
          success: false,
          message: `Verify failed at page ${page} (address 0x${(page * FLASH_PAGESIZE).toString(16)})`,
        };
      }

      pagesVerified++;
      onProgress?.((analysis.totalPages + pagesVerified) / (analysis.totalPages * 2));
    }
  }

  // Leave bootloader so the sketch starts running
  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }
  try {
    await protocol.leaveProgramming();
    await protocol.exitBootloader();
  } catch { /* ignore — device disconnects */ }

  return { success: true, message: `Sketch uploaded successfully (${pagesWritten} pages).` };
}

/**
 * Backup the current sketch from the Arduboy's internal flash.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Object} [options]
 * @param {boolean} [options.includeBootloader=false] - Include bootloader area
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<Uint8Array>} Raw flash data
 */
export async function backupSketch(protocol, { includeBootloader = false, onProgress } = {}) {
  const totalBytes = includeBootloader ? FLASH_SIZE : 0x7000; // 28KB app area
  const totalPages = totalBytes / FLASH_PAGESIZE;
  const data = new Uint8Array(totalBytes);

  try { await protocol.setLed(LED_PRESET.BLUE_LOCKED); } catch (_) { /* Caterina */ }

  for (let page = 0; page < totalPages; page++) {
    const pageData = await protocol.readFlashPage(page);
    data.set(pageData, page * FLASH_PAGESIZE);
    onProgress?.(page / totalPages);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch (_) { /* Caterina */ }
  return data;
}

/**
 * Erase the sketch by clearing the first flash page.
 * This prevents the sketch from starting, keeping the bootloader active.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function eraseSketch(protocol) {
  try { await protocol.setLed(LED_PRESET.RED_LOCKED); } catch (_) { /* Caterina */ }

  // Write an empty page (zero length triggers page erase in Caterina)
  await protocol.setFlashPage(0);
  await protocol.blockWrite(MEM_TYPE.FLASH, new Uint8Array(0));

  // Verify page 0 is erased
  const page0 = await protocol.readFlashPage(0);
  const erased = page0.every((b) => b === 0xff);

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch (_) { /* Caterina */ }

  return {
    success: erased,
    message: erased ? 'Sketch erased successfully.' : 'Erase verification failed.',
  };
}
