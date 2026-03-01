/**
 * Binary utility functions.
 *
 * Ported from: arduboy_toolset/arduboy/common.py
 * Pure functions, no dependencies on other modules.
 */

/**
 * Concatenate multiple Uint8Arrays into one.
 * @param {...Uint8Array} arrays
 * @returns {Uint8Array}
 */
export function concat(...arrays) {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Pad data to a multiple of the given alignment.
 * @param {Uint8Array} data - Data to pad
 * @param {number} alignment - Alignment boundary (e.g. 256 for page, 4096 for save)
 * @param {number} [padByte=0xFF] - Byte value to use for padding
 * @returns {Uint8Array} Padded data (may be a new array or the original if already aligned)
 */
export function padData(data, alignment, padByte = 0xff) {
  const remainder = data.length % alignment;
  if (remainder === 0) return data;
  const padLength = alignment - remainder;
  const padding = new Uint8Array(padLength).fill(padByte);
  return concat(data, padding);
}

/**
 * Calculate padding needed to reach alignment boundary.
 * @param {number} length - Current length
 * @param {number} alignment - Alignment boundary
 * @returns {number} Number of padding bytes needed
 */
export function padSize(length, alignment) {
  const remainder = length % alignment;
  return remainder === 0 ? 0 : alignment - remainder;
}

/**
 * Extract a single bit from a byte.
 * @param {number} byte - The byte value
 * @param {number} pos - Bit position (0 = LSB)
 * @returns {number} 0 or 1
 */
export function byteBit(byte, pos) {
  return (byte >> pos) & 1;
}

/**
 * Convert an integer to a hex string with fixed width.
 * @param {number} value - Integer value
 * @param {number} hexChars - Number of hex characters
 * @returns {string} Hex string (e.g. "0A3F")
 */
export function intToHex(value, hexChars) {
  return value.toString(16).toUpperCase().padStart(hexChars, '0');
}

/**
 * Read a big-endian uint16 from a Uint8Array at the given offset.
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {number}
 */
export function readUint16BE(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

/**
 * Write a big-endian uint16 into a Uint8Array at the given offset.
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {number} value
 */
export function writeUint16BE(data, offset, value) {
  data[offset] = (value >> 8) & 0xff;
  data[offset + 1] = value & 0xff;
}

/**
 * Read a big-endian uint24 from a Uint8Array at the given offset.
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {number}
 */
export function readUint24BE(data, offset) {
  return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

/**
 * Write a big-endian uint24 into a Uint8Array at the given offset.
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {number} value
 */
export function writeUint24BE(data, offset, value) {
  data[offset] = (value >> 16) & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
  data[offset + 2] = value & 0xff;
}

/**
 * Count trailing empty (0xFF) pages in data.
 * @param {Uint8Array} data - Data to scan (must be page-aligned)
 * @param {number} [pageSize=256] - Page size in bytes
 * @returns {number} Number of trailing all-0xFF pages
 */
export function countUnusedPages(data, pageSize = 256) {
  let count = 0;
  for (let offset = data.length - pageSize; offset >= 0; offset -= pageSize) {
    let allFF = true;
    for (let i = 0; i < pageSize; i++) {
      if (data[offset + i] !== 0xff) {
        allFF = false;
        break;
      }
    }
    if (!allFF) break;
    count++;
  }
  return count;
}

/**
 * Check if a region of data is all 0xFF (erased/empty).
 * @param {Uint8Array} data
 * @param {number} [offset=0]
 * @param {number} [length=data.length]
 * @returns {boolean}
 */
export function isEmpty(data, offset = 0, length = data.length - offset) {
  for (let i = offset; i < offset + length; i++) {
    if (data[i] !== 0xff) return false;
  }
  return true;
}

/**
 * Compare two Uint8Arrays for equality.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a Uint8Array filled with a specific byte value.
 * @param {number} length
 * @param {number} [fillByte=0xFF]
 * @returns {Uint8Array}
 */
export function filledArray(length, fillByte = 0xff) {
  return new Uint8Array(length).fill(fillByte);
}

/**
 * Compute SHA-256 hash of data.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>} 32-byte hash
 */
export async function sha256(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Encode a string as UTF-8 bytes.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeString(str) {
  return new TextEncoder().encode(str);
}

/**
 * Decode UTF-8 bytes to a string.
 * @param {Uint8Array} data
 * @returns {string}
 */
export function decodeString(data) {
  return new TextDecoder().decode(data);
}

/**
 * Sleep for given milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
