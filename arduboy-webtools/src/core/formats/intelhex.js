/**
 * Intel HEX format parser and generator.
 *
 * Handles parsing Intel HEX strings into binary data and
 * generating Intel HEX strings from binary data.
 *
 * Ported from:
 *   - ArduboyWebFlasher parseIntelHex() (based on bminer/intel-hex.js)
 *   - arduboy_toolset/arduboy/common.py hex_to_bin / bin_to_hex
 *   - Arduboy-Python-Utilities uploader.py
 */

import { FLASH_SIZE } from '../constants.js';
import { intToHex } from '../utils/binary.js';

/**
 * @typedef {Object} ParsedHex
 * @property {Uint8Array} data - Binary data (32KB, padded with 0xFF)
 * @property {boolean[]} pageUsed - Which 128-byte pages contain actual data
 * @property {number} startAddress - Start segment/linear address (if present, else 0)
 * @property {number} dataLength - Actual data length (highest address + 1)
 */

/**
 * Parse an Intel HEX string into binary data.
 *
 * @param {string} hexString - Complete Intel HEX file contents
 * @param {number} [maxSize=FLASH_SIZE] - Maximum data size (default 32KB for ATmega32U4)
 * @returns {ParsedHex}
 * @throws {Error} On invalid hex data, bad checksums, or missing EOF
 */
export function parseIntelHex(hexString, maxSize = FLASH_SIZE) {
  const data = new Uint8Array(maxSize).fill(0xff);
  const pageUsed = new Array(Math.ceil(maxSize / 128)).fill(false);
  let highAddress = 0; // Extended address (from type 02/04 records)
  let startAddress = 0;
  let maxAddress = 0;
  let hasEOF = false;

  const lines = hexString.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed[0] !== ':') {
      throw new Error(`Invalid Intel HEX line (missing ':'): ${trimmed.substring(0, 40)}`);
    }

    // Parse fields
    const hex = trimmed.substring(1);
    if (hex.length < 10) {
      throw new Error(`Intel HEX line too short: ${trimmed}`);
    }

    const byteCount = parseInt(hex.substring(0, 2), 16);
    const address = parseInt(hex.substring(2, 6), 16);
    const recordType = parseInt(hex.substring(6, 8), 16);

    // Validate minimum length: byteCount bytes of data + 1 checksum byte = (byteCount + 1) * 2 hex chars + 8 header chars
    const expectedLength = 8 + byteCount * 2 + 2;
    if (hex.length < expectedLength) {
      throw new Error(`Intel HEX line has incorrect length: expected ${expectedLength + 1}, got ${trimmed.length}`);
    }

    // Parse all bytes for checksum validation
    let checksum = 0;
    const bytes = [];
    for (let i = 0; i < hex.length - 2; i += 2) {
      const b = parseInt(hex.substring(i, i + 2), 16);
      checksum += b;
      if (i >= 8 && bytes.length < byteCount) {
        bytes.push(b);
      }
    }
    const recordChecksum = parseInt(hex.substring(hex.length - 2), 16);
    checksum += recordChecksum;
    if ((checksum & 0xff) !== 0) {
      throw new Error(`Intel HEX checksum error on line: ${trimmed.substring(0, 40)}`);
    }

    switch (recordType) {
      case 0x00: // Data record
        {
          const fullAddress = highAddress + address;
          for (let i = 0; i < byteCount; i++) {
            const addr = fullAddress + i;
            if (addr < maxSize) {
              data[addr] = bytes[i];
              const page = Math.floor(addr / 128);
              if (page < pageUsed.length) {
                pageUsed[page] = true;
              }
              if (addr + 1 > maxAddress) {
                maxAddress = addr + 1;
              }
            }
          }
        }
        break;

      case 0x01: // End Of File
        hasEOF = true;
        break;

      case 0x02: // Extended Segment Address
        highAddress = ((bytes[0] << 8) | bytes[1]) << 4;
        break;

      case 0x03: // Start Segment Address
        startAddress = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
        break;

      case 0x04: // Extended Linear Address
        highAddress = ((bytes[0] << 8) | bytes[1]) << 16;
        break;

      case 0x05: // Start Linear Address
        startAddress = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
        break;

      default:
        // Unknown record type — ignore per spec
        break;
    }

    if (hasEOF) break;
  }

  if (!hasEOF) {
    throw new Error('Intel HEX file missing EOF record');
  }

  return {
    data,
    pageUsed,
    startAddress,
    dataLength: maxAddress,
  };
}

/**
 * Generate an Intel HEX string from binary data.
 *
 * @param {Uint8Array} data - Binary data to encode
 * @param {number} [bytesPerLine=16] - Data bytes per HEX record (default 16)
 * @returns {string} Intel HEX format string
 */
export function generateIntelHex(data, bytesPerLine = 16) {
  const lines = [];

  for (let offset = 0; offset < data.length; offset += bytesPerLine) {
    const count = Math.min(bytesPerLine, data.length - offset);
    const address = offset & 0xffff;

    // Extended linear address record if needed
    if (offset > 0 && (offset & 0xffff) === 0) {
      const extAddr = (offset >> 16) & 0xffff;
      const extLine = `:02000004${intToHex(extAddr, 4)}`;
      lines.push(extLine + computeChecksum(extLine));
    }

    // Data record
    let line = `:${intToHex(count, 2)}${intToHex(address, 4)}00`;
    for (let i = 0; i < count; i++) {
      line += intToHex(data[offset + i], 2);
    }
    lines.push(line + computeChecksum(line));
  }

  // EOF record
  lines.push(':00000001FF');
  lines.push(''); // Trailing newline

  return lines.join('\n');
}

/**
 * Compute the Intel HEX checksum for a record line.
 * @param {string} line - Record line starting with ':'
 * @returns {string} Two-character hex checksum
 */
function computeChecksum(line) {
  const hex = line.substring(1);
  let sum = 0;
  for (let i = 0; i < hex.length; i += 2) {
    sum += parseInt(hex.substring(i, i + 2), 16);
  }
  return intToHex((~sum + 1) & 0xff, 2);
}
