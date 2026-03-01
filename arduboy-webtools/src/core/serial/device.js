/**
 * Arduboy device discovery and connection management.
 *
 * Handles USB device detection, bootloader mode entry,
 * and device type identification.
 *
 * Ported from: arduboy_toolset/arduboy/device.py
 */

import { USB_FILTERS, isBootloaderFilter, DEVICE_TYPE } from '../constants.js';
import { SerialTransport } from './transport.js';
import { ArduboyProtocol } from './protocol.js';
import { sleep } from '../utils/binary.js';

/**
 * @typedef {Object} DeviceInfo
 * @property {string} type - DEVICE_TYPE value (Arduboy, ArduboyFX, ArduboyMini)
 * @property {number} bootloaderVersion - Bootloader version number
 * @property {string} identifier - Bootloader identifier string
 * @property {boolean} hasFx - Whether device has FX flash support
 * @property {import('./protocol.js').JedecInfo|null} jedec - FX flash chip info (null if no FX)
 */

export class DeviceManager {
  /** @type {SerialTransport} */
  #transport;

  /** @type {ArduboyProtocol|null} */
  #protocol = null;

  /** @type {DeviceInfo|null} */
  #deviceInfo = null;

  constructor() {
    this.#transport = new SerialTransport();
  }

  /**
   * Get the active serial transport.
   * @returns {SerialTransport}
   */
  get transport() {
    return this.#transport;
  }

  /**
   * Get the active protocol interface.
   * @returns {ArduboyProtocol|null}
   */
  get protocol() {
    return this.#protocol;
  }

  /**
   * Get cached device info (from last connect).
   * @returns {DeviceInfo|null}
   */
  get deviceInfo() {
    return this.#deviceInfo;
  }

  /**
   * Whether a device is currently connected and open.
   * @returns {boolean}
   */
  get isConnected() {
    return this.#transport.isOpen;
  }

  /**
   * Connect to an Arduboy device.
   *
   * This triggers the browser's port picker dialog (requires user gesture).
   * If the device is in application mode, it will optionally enter bootloader.
   *
   * @param {Object} [options]
   * @param {boolean} [options.enterBootloader=true] - Whether to auto-enter bootloader mode
   * @param {number} [options.baudRate=115200] - Baud rate for communication
   * @returns {Promise<DeviceInfo>} Information about the connected device
   */
  async connect({ enterBootloader = true, baudRate = 115200 } = {}) {
    // Request port from user (shows browser picker)
    await this.#transport.requestPort(USB_FILTERS);

    // Check if the selected device is already in bootloader mode
    const portInfo = this.#transport.getPortInfo();
    const inBootloader = portInfo ? isBootloaderFilter(portInfo) : false;

    if (!inBootloader && enterBootloader) {
      // Device is in application mode — need to reset into bootloader
      await this.#transport.triggerBootloaderReset();

      // After reset, device re-enumerates with a different PID.
      // We need to request the port again.
      await sleep(1000);
      await this.#transport.requestPort(USB_FILTERS);
    }

    // Open the port for communication
    await this.#transport.open(baudRate);

    // Create protocol interface
    this.#protocol = new ArduboyProtocol(this.#transport);

    // Gather device information
    this.#deviceInfo = await this.#probeDevice();

    return this.#deviceInfo;
  }

  /**
   * Disconnect from the device.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.#protocol) {
      try {
        await this.#protocol.exitBootloader();
      } catch { /* Device may already be disconnected */ }
    }
    await this.#transport.close();
    this.#protocol = null;
    this.#deviceInfo = null;
  }

  /**
   * Close the connection without exiting bootloader.
   * Use when you want the device to stay in bootloader mode.
   * @returns {Promise<void>}
   */
  async closePort() {
    await this.#transport.close();
    this.#protocol = null;
  }

  /**
   * Probe device to gather version, FX support, and JEDEC info.
   * @returns {Promise<DeviceInfo>}
   */
  async #probeDevice() {
    const identifier = await this.#protocol.getIdentifier();
    const version = await this.#protocol.getVersion();
    const hasFx = version >= 13;

    /** @type {import('./protocol.js').JedecInfo|null} */
    let jedec = null;
    let type = DEVICE_TYPE.ARDUBOY;

    if (hasFx) {
      try {
        jedec = await this.#protocol.getJedecId();
        // Default to FX if has external flash; can be refined by sketch analysis
        type = DEVICE_TYPE.ARDUBOY_FX;
      } catch {
        // No flash chip or read failed — plain Arduboy with Cathy3K
      }
    }

    return {
      type,
      bootloaderVersion: version,
      identifier,
      hasFx,
      jedec,
    };
  }
}
