/**
 * AVR109/Caterina serial protocol implementation.
 *
 * Provides typed methods for every bootloader command used by
 * Arduboy (Caterina) and Arduboy FX (Cathy3K) bootloaders.
 *
 * Ported from:
 *   - arduboy_toolset/arduboy/serial.py
 *   - Arduboy-Python-Utilities (uploader.py, flashcart-writer.py, etc.)
 *   - ArduboyWebFlasher/index.html
 */

import { CMD, MEM_TYPE, ACK, CATHY3K_MIN_VERSION, JEDEC_MANUFACTURERS } from '../constants.js';
import { readUint16BE, decodeString } from '../utils/binary.js';

/**
 * @typedef {Object} JedecInfo
 * @property {number} manufacturerId - Manufacturer byte
 * @property {string} manufacturer - Manufacturer name
 * @property {number} deviceType - Device type byte
 * @property {number} capacityId - Capacity byte
 * @property {number} capacity - Capacity in bytes (1 << capacityId)
 * @property {Uint8Array} raw - Raw 3-byte JEDEC response
 */

export class ArduboyProtocol {
  /** @type {import('./transport.js').SerialTransport} */
  #transport;

  /**
   * @param {import('./transport.js').SerialTransport} transport - Open serial transport
   */
  constructor(transport) {
    this.#transport = transport;
  }

  // ===========================================================================
  // Identification & Version
  // ===========================================================================

  /**
   * Get the bootloader software identifier string.
   * @returns {Promise<string>} e.g. "ARDUBOY" or "CATERINA"
   */
  async getIdentifier() {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.GET_IDENTIFIER]),
      7
    );
    return decodeString(response);
  }

  /**
   * Get the bootloader version number.
   * Returns ≥13 for Cathy3K with FX support.
   * @returns {Promise<number>} Version as integer (e.g. 10, 13)
   */
  async getVersion() {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.GET_VERSION]),
      2
    );
    return parseInt(decodeString(response), 10);
  }

  /**
   * Check if the bootloader supports FX flash operations.
   * Requires Cathy3K version ≥ 1.3 (version byte ≥ 13).
   * @returns {Promise<boolean>}
   */
  async supportsFx() {
    const version = await this.getVersion();
    return version >= CATHY3K_MIN_VERSION;
  }

  // ===========================================================================
  // Programming Mode
  // ===========================================================================

  /**
   * Enter programming mode.
   * @returns {Promise<void>}
   */
  async enterProgramming() {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.ENTER_PROGRAMMING]),
      1
    );
    if (response[0] !== ACK) {
      throw new Error(`Enter programming failed: expected ACK (0x0D), got 0x${response[0].toString(16)}`);
    }
  }

  /**
   * Leave programming mode.
   * @returns {Promise<void>}
   */
  async leaveProgramming() {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.LEAVE_PROGRAMMING]),
      1
    );
    if (response[0] !== ACK) {
      throw new Error(`Leave programming failed: expected ACK (0x0D), got 0x${response[0].toString(16)}`);
    }
  }

  /**
   * Exit the bootloader and start the application.
   * After this call, the device will disconnect from serial.
   * @returns {Promise<void>}
   */
  async exitBootloader() {
    await this.#transport.write(new Uint8Array([CMD.EXIT_BOOTLOADER]));
    // Don't wait for response — device disconnects immediately
  }

  // ===========================================================================
  // Address & Memory Access
  // ===========================================================================

  /**
   * Set the current address for subsequent read/write operations.
   *
   * Address interpretation depends on memory type:
   * - Internal flash (F): word address (page × 64)
   * - External flash (C): page number (256 bytes per page)
   * - EEPROM (E): byte address
   *
   * @param {number} address - Address value (interpretation depends on context)
   * @returns {Promise<void>}
   */
  async setAddress(address) {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.SET_ADDRESS, (address >> 8) & 0xff, address & 0xff]),
      1
    );
    if (response[0] !== ACK) {
      throw new Error(`Set address failed at 0x${address.toString(16)}`);
    }
  }

  /**
   * Set address for internal flash by page number.
   * Converts 128-byte page index to word address.
   * @param {number} page - Page number (0-255)
   * @returns {Promise<void>}
   */
  async setFlashPage(page) {
    // Word address: page × 64 words (128 bytes = 64 words)
    // Encoded as: hi = page >> 2, lo = (page & 3) << 6
    const wordAddr = page * 64;
    await this.setAddress(wordAddr);
  }

  /**
   * Set address for external FX flash by page number.
   * @param {number} page - FX page number (256 bytes per page)
   * @returns {Promise<void>}
   */
  async setFxPage(page) {
    await this.setAddress(page);
  }

  /**
   * Write a block of data to memory.
   * @param {number} memType - Memory type: MEM_TYPE.FLASH, MEM_TYPE.EEPROM, or MEM_TYPE.FX
   * @param {Uint8Array} data - Data to write
   * @returns {Promise<void>}
   */
  async blockWrite(memType, data) {
    const len = data.length;
    // Command: 'B' + length (2 bytes BE) + type byte
    const cmd = new Uint8Array([CMD.BLOCK_WRITE, (len >> 8) & 0xff, len & 0xff, memType]);
    await this.#transport.write(cmd);
    const response = await this.#transport.writeAndRead(data, 1);
    if (response[0] !== ACK) {
      throw new Error(`Block write failed (type ${String.fromCharCode(memType)}, ${len} bytes)`);
    }
  }

  /**
   * Read a block of data from memory.
   * @param {number} memType - Memory type
   * @param {number} length - Number of bytes to read
   * @returns {Promise<Uint8Array>} Read data
   */
  async blockRead(memType, length) {
    const cmd = new Uint8Array([CMD.BLOCK_READ, (length >> 8) & 0xff, length & 0xff, memType]);
    return this.#transport.writeAndRead(cmd, length);
  }

  // ===========================================================================
  // Lock Bits
  // ===========================================================================

  /**
   * Read the lock bits.
   * Used to check bootloader write protection.
   * @returns {Promise<number>} Lock bits byte
   */
  async readLockBits() {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.READ_LOCK_BITS]),
      1
    );
    return response[0];
  }

  // ===========================================================================
  // FX-Specific Commands (Cathy3K ≥ 1.3)
  // ===========================================================================

  /**
   * Read the JEDEC ID of the external SPI flash chip.
   * Reads twice and compares for reliability (as per Python utilities).
   *
   * @returns {Promise<JedecInfo>} Flash chip information
   * @throws {Error} If no flash chip detected or reads don't match
   */
  async getJedecId() {
    const id1 = await this.#transport.writeAndRead(new Uint8Array([CMD.GET_JEDEC_ID]), 3, 2000);

    // Small delay between reads (Python utilities use 0.5s)
    await new Promise((r) => setTimeout(r, 200));

    const id2 = await this.#transport.writeAndRead(new Uint8Array([CMD.GET_JEDEC_ID]), 3, 2000);

    // Verify both reads match
    if (id1[0] !== id2[0] || id1[1] !== id2[1] || id1[2] !== id2[2]) {
      throw new Error('JEDEC ID reads do not match — unreliable connection.');
    }

    // Check for invalid IDs (no chip)
    if ((id1[0] === 0x00 && id1[1] === 0x00 && id1[2] === 0x00) ||
        (id1[0] === 0xff && id1[1] === 0xff && id1[2] === 0xff)) {
      throw new Error('No external flash chip detected (JEDEC ID: all zeros or all FFs).');
    }

    return {
      manufacturerId: id1[0],
      manufacturer: JEDEC_MANUFACTURERS[id1[0]] || `Unknown (0x${id1[0].toString(16)})`,
      deviceType: id1[1],
      capacityId: id1[2],
      capacity: 1 << id1[2],
      raw: new Uint8Array(id1),
    };
  }

  /**
   * Set LED state and button control.
   * @param {number} flags - LED control flags (see LED_PRESET in constants)
   * @returns {Promise<void>}
   */
  async setLed(flags) {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.LED_CONTROL, flags]),
      1
    );
    if (response[0] !== ACK) {
      throw new Error('LED control failed.');
    }
  }

  /**
   * Select a 16MB cart slot (for >16MB flash chips).
   * @param {number} slot - Cart slot number (0, 1, 2, ...)
   * @returns {Promise<void>}
   */
  async selectCartSlot(slot) {
    const response = await this.#transport.writeAndRead(
      new Uint8Array([CMD.SELECT_CART_SLOT, slot]),
      1
    );
    if (response[0] !== ACK) {
      throw new Error(`Select cart slot ${slot} failed.`);
    }
  }

  // ===========================================================================
  // High-Level Convenience Methods
  // ===========================================================================

  /**
   * Write a single 128-byte page to internal flash.
   * Sets the address and writes the page in one operation.
   *
   * @param {number} pageIndex - Page number (0-255)
   * @param {Uint8Array} pageData - Exactly 128 bytes
   * @returns {Promise<void>}
   */
  async writeFlashPage(pageIndex, pageData) {
    if (pageData.length !== 128) {
      throw new Error(`Flash page must be 128 bytes, got ${pageData.length}`);
    }
    await this.setFlashPage(pageIndex);
    await this.blockWrite(MEM_TYPE.FLASH, pageData);
  }

  /**
   * Read a single 128-byte page from internal flash.
   * @param {number} pageIndex - Page number (0-255)
   * @returns {Promise<Uint8Array>} 128 bytes
   */
  async readFlashPage(pageIndex) {
    await this.setFlashPage(pageIndex);
    return this.blockRead(MEM_TYPE.FLASH, 128);
  }

  /**
   * Write a 64KB block to external FX flash.
   * @param {number} blockIndex - Block number (0-255)
   * @param {Uint8Array} blockData - Up to 65536 bytes
   * @returns {Promise<void>}
   */
  async writeFxBlock(blockIndex, blockData) {
    const pageAddr = blockIndex * 256; // 256 pages per block
    await this.setFxPage(pageAddr);
    await this.blockWrite(MEM_TYPE.FX, blockData);
  }

  /**
   * Read a 64KB block from external FX flash.
   * @param {number} blockIndex - Block number (0-255)
   * @returns {Promise<Uint8Array>} 65536 bytes
   */
  async readFxBlock(blockIndex) {
    const pageAddr = blockIndex * 256;
    await this.setFxPage(pageAddr);
    return this.blockRead(MEM_TYPE.FX, 65536);
  }

  /**
   * Read N bytes from external FX flash starting at a page.
   * @param {number} page - Start page number
   * @param {number} length - Number of bytes to read
   * @returns {Promise<Uint8Array>}
   */
  async readFxPages(page, length) {
    await this.setFxPage(page);
    return this.blockRead(MEM_TYPE.FX, length);
  }
}
