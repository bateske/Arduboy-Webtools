/**
 * EEPROM operations.
 *
 * Read, write, and erase the ATmega32U4's 1KB EEPROM.
 *
 * Ported from:
 *   - Arduboy-Python-Utilities/eeprom-backup.py, eeprom-restore.py, eeprom-erase.py
 *   - arduboy_toolset/arduboy/serial.py (read_eeprom, write_eeprom, erase_eeprom)
 */

import { EEPROM_SIZE, MEM_TYPE, LED_PRESET } from '../constants.js';
import { filledArray } from '../utils/binary.js';

/** Chunk size for EEPROM transfers (bytes). Smaller chunks give smoother progress. */
const EEPROM_CHUNK = 128;

/**
 * Read the full EEPROM (1024 bytes).
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @returns {Promise<Uint8Array>} 1024 bytes of EEPROM data
 */
export async function readEeprom(protocol, { onProgress } = {}) {
  try { await protocol.setLed(LED_PRESET.BLUE_LOCKED); } catch { /* Caterina */ }

  const totalChunks = EEPROM_SIZE / EEPROM_CHUNK;
  const result = new Uint8Array(EEPROM_SIZE);

  await protocol.setAddress(0x0000); // EEPROM byte address 0
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await protocol.blockRead(MEM_TYPE.EEPROM, EEPROM_CHUNK);
    result.set(chunk, i * EEPROM_CHUNK);
    onProgress?.((i + 1) / totalChunks);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* Caterina */ }
  return result;
}

/**
 * Write data to the full EEPROM.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Uint8Array} data - Exactly 1024 bytes
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @returns {Promise<void>}
 * @throws {Error} If data is not exactly 1024 bytes
 */
export async function writeEeprom(protocol, data, { onProgress } = {}) {
  if (data.length !== EEPROM_SIZE) {
    throw new Error(`EEPROM data must be exactly ${EEPROM_SIZE} bytes, got ${data.length}`);
  }
  try { await protocol.setLed(LED_PRESET.RED_LOCKED); } catch { /* Caterina */ }

  const totalChunks = EEPROM_SIZE / EEPROM_CHUNK;

  await protocol.setAddress(0x0000);
  for (let i = 0; i < totalChunks; i++) {
    const offset = i * EEPROM_CHUNK;
    await protocol.blockWrite(MEM_TYPE.EEPROM, data.subarray(offset, offset + EEPROM_CHUNK));
    onProgress?.((i + 1) / totalChunks);
  }

  try { await protocol.setLed(LED_PRESET.OFF_ACTIVE); } catch { /* Caterina */ }
}

/**
 * Erase the EEPROM by writing all 0xFF.
 *
 * @param {import('../serial/protocol.js').ArduboyProtocol} protocol
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Progress callback (0.0 to 1.0)
 * @returns {Promise<void>}
 */
export async function eraseEeprom(protocol, { onProgress } = {}) {
  const eraseData = filledArray(EEPROM_SIZE, 0xff);
  await writeEeprom(protocol, eraseData, { onProgress });
}
