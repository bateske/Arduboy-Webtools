/**
 * FX external flash operations.
 *
 * Read, write, scan, and manage the external SPI flash chip.
 *
 * Ported from:
 *   - Arduboy-Python-Utilities/flashcart-writer.py, flashcart-backup.py
 *   - arduboy_toolset/arduboy/serial.py (flash_fx, backup_fx, scan_fx)
 *   - ArduboyWebFlasher flashFx(), flashBlock()
 */

import {
  FX_PAGESIZE, FX_BLOCKSIZE, FX_PAGES_PER_BLOCK,
  FX_MAX_PAGES, MEM_TYPE, LED_PRESET,
} from '../constants.js';
import { concat, padData, arraysEqual, filledArray, sleep } from '../utils/binary.js';

/**
 * Write data to the external FX flash.
 *
 * Handles partial block preservation at start and end boundaries.
 * Writes in 64KB blocks (the FX flash erase unit).
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Uint8Array} data - Data to write
 * @param {number} [startPage=0] - Starting page number (negative = offset from end)
 * @param {Object} [options]
 * @param {boolean} [options.verify=false] - Verify after writing each block
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @param {Function} [options.onStatus] - Status message callback
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function writeFx(protocol, data, startPage = 0, { verify = false, onProgress, onStatus } = {}) {
  // Validate startPage is a number to guard against accidentally passing options as startPage
  if (typeof startPage !== 'number' || Number.isNaN(startPage)) {
    throw new Error(`writeFx: startPage must be a number, got ${typeof startPage}`);
  }

  // Handle negative page (write at end of flash)
  if (startPage < 0) {
    startPage = FX_MAX_PAGES + startPage;
  }

  let flashData = new Uint8Array(data);

  // Preserve partial block at start
  if (startPage % FX_PAGES_PER_BLOCK !== 0) {
    onStatus?.('Reading partial start block...');
    const preservePages = startPage % FX_PAGES_PER_BLOCK;
    const preserveLen = preservePages * FX_PAGESIZE;
    const blockStart = Math.floor(startPage / FX_PAGES_PER_BLOCK) * FX_PAGES_PER_BLOCK;

    await protocol.setFxPage(blockStart);
    const preserved = await protocol.blockRead(MEM_TYPE.FX, preserveLen);
    flashData = concat(preserved, flashData);
    startPage = blockStart;
  }

  // Preserve partial block at end
  if (flashData.length % FX_BLOCKSIZE !== 0) {
    onStatus?.('Reading partial end block...');
    const endPage = startPage + Math.ceil(flashData.length / FX_PAGESIZE);
    const blockEnd = Math.ceil(endPage / FX_PAGES_PER_BLOCK) * FX_PAGES_PER_BLOCK;
    const preserveLen = (blockEnd - endPage) * FX_PAGESIZE;

    if (preserveLen > 0 && endPage < FX_MAX_PAGES) {
      await protocol.setFxPage(endPage);
      const preserved = await protocol.blockRead(MEM_TYPE.FX, preserveLen);
      flashData = concat(flashData, preserved);
    } else {
      // Pad to block boundary
      flashData = padData(flashData, FX_BLOCKSIZE);
    }
  }

  const totalBlocks = flashData.length / FX_BLOCKSIZE;
  onStatus?.(`Writing ${totalBlocks} blocks to FX flash...`);

  for (let block = 0; block < totalBlocks; block++) {
    // Red LED while writing (non-fatal on Caterina)
    try { await protocol.setLed(LED_PRESET.RED_LOCKED); } catch { /* ignore */ }

    const blockData = flashData.slice(block * FX_BLOCKSIZE, (block + 1) * FX_BLOCKSIZE);
    const blockPage = startPage + block * FX_PAGES_PER_BLOCK;

    await protocol.setFxPage(blockPage);
    await protocol.blockWrite(MEM_TYPE.FX, blockData);

    // Verify this block if requested
    if (verify) {
      try { await protocol.setLed(LED_PRESET.BLUE_LOCKED); } catch { /* ignore */ }
      await protocol.setFxPage(blockPage);
      const readBack = await protocol.blockRead(MEM_TYPE.FX, FX_BLOCKSIZE);
      if (!arraysEqual(blockData, readBack)) {
        try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }
        return {
          success: false,
          message: `FX verify failed at block ${block} (page ${blockPage})`,
        };
      }
    }

    onProgress?.((block + 1) / totalBlocks);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }
  return {
    success: true,
    message: `FX flash written successfully (${totalBlocks} blocks, ${flashData.length} bytes).`,
  };
}

/**
 * Backup the FX flash chip.
 *
 * If maxPages is provided, reads only that many pages (for trimmed cart backups).
 * Otherwise reads all blocks up to the detected chip capacity.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Object} [options]
 * @param {number} [options.maxPages] - Limit download to this many pages (for cart-only mode)
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @param {Function} [options.onStatus] - Status message callback
 * @returns {Promise<Uint8Array>} Flash contents
 */
export async function backupFx(protocol, { maxPages, onProgress, onStatus } = {}) {
  let totalBytes;
  let totalBlocks;

  if (maxPages && maxPages > 0) {
    // Trimmed: round up to nearest block boundary
    totalBlocks = Math.ceil(maxPages / FX_PAGES_PER_BLOCK);
    totalBytes = totalBlocks * FX_BLOCKSIZE;
    onStatus?.(`Backing up ${totalBlocks} blocks (${(totalBytes / 1024 / 1024).toFixed(1)}MB cart data)...`);
  } else {
    // Full: detect flash capacity via JEDEC ID
    const jedec = await protocol.getJedecId();
    totalBytes = jedec.capacity;
    totalBlocks = totalBytes / FX_BLOCKSIZE;
    onStatus?.(`Backing up ${(totalBytes / 1024 / 1024).toFixed(0)}MB FX flash (${jedec.manufacturer})...`);
  }

  await protocol.setLed(LED_PRESET.BLUE_LOCKED);

  const parts = [];

  for (let block = 0; block < totalBlocks; block++) {
    const blockPage = block * FX_PAGES_PER_BLOCK;
    await protocol.setFxPage(blockPage);
    const blockData = await protocol.blockRead(MEM_TYPE.FX, FX_BLOCKSIZE);
    parts.push(blockData);
    onProgress?.((block + 1) / totalBlocks);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }
  return concat(...parts);
}

/**
 * Scan FX cart by reading only slot headers (fast).
 * Returns summary information without downloading all data.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{slotCount: number, categories: number, games: number, totalPages: number}>}
 */
export async function scanFx(protocol, { onProgress } = {}) {
  const MAGIC = new Uint8Array([0x41, 0x52, 0x44, 0x55, 0x42, 0x4f, 0x59]);
  let page = 0;
  let slotCount = 0;
  let categories = 0;
  let games = 0;

  await protocol.setLed(LED_PRESET.BLUE_LOCKED);

  while (page < FX_MAX_PAGES) {
    // Read header (256 bytes = 1 page)
    await protocol.setFxPage(page);
    const header = await protocol.blockRead(MEM_TYPE.FX, FX_PAGESIZE);

    // Check for magic bytes
    let isMagic = true;
    for (let i = 0; i < MAGIC.length; i++) {
      if (header[i] !== MAGIC[i]) {
        isMagic = false;
        break;
      }
    }
    if (!isMagic) break;

    // Read slot info from header
    const programSize = header[0x0E]; // Program size in half-pages
    const slotSize = (header[0x0C] << 8) | header[0x0D]; // Pages

    if (programSize === 0) {
      categories++;
    } else {
      games++;
    }
    slotCount++;

    if (slotSize === 0) break;
    page += slotSize;

    onProgress?.(page / FX_MAX_PAGES);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* ignore */ }

  return { slotCount, categories, games, totalPages: page };
}

/**
 * Write development FX data to the end of flash.
 * Used during game development for testing FX data.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Uint8Array} data - FX data binary
 * @param {Uint8Array} [save] - FX save binary (optional)
 * @param {Object} [options]
 * @param {Function} [options.onProgress]
 * @param {Function} [options.onStatus]
 * @returns {Promise<{success: boolean, dataPage: number, savePage: number}>}
 */
export async function writeFxDev(protocol, data, save = null, { onProgress, onStatus } = {}) {
  const paddedData = padData(data, FX_PAGESIZE);
  const paddedSave = save ? padData(save, 4096) : new Uint8Array(0);
  const combined = concat(paddedData, paddedSave);
  const totalPages = combined.length / FX_PAGESIZE;

  // Place at end of flash
  const startPage = FX_MAX_PAGES - totalPages;
  const dataPage = startPage;
  const savePage = save ? startPage + paddedData.length / FX_PAGESIZE : 0;

  onStatus?.(`Writing dev FX data at page ${startPage}...`);

  const result = await writeFx(protocol, combined, startPage, { onProgress, onStatus });

  return {
    success: result.success,
    dataPage,
    savePage,
  };
}
