/**
 * Binary patching operations.
 *
 * All patches modify program bytearrays in-place and return
 * success/failure with messages.
 *
 * Ported from:
 *   - arduboy_toolset/arduboy/patch.py
 *   - Arduboy-Python-Utilities/uploader.py (SSD1309, Micro LED patches)
 */

import { RETI_BYTES, FX_DATA_PAGE_OFFSET, FX_SAVE_PAGE_OFFSET } from '../constants.js';
import { writeUint16BE } from '../utils/binary.js';

// =============================================================================
// SSD1309 Display Patch
// =============================================================================

/** LCD boot program signature to search for */
const LCD_BOOT_PATTERN = new Uint8Array([0xd5, 0xf0, 0x8d, 0x14, 0xa1, 0xc8, 0x81, 0xcf, 0xd9, 0xf1, 0xaf, 0x20, 0x00]);

/**
 * Patch hex data for SSD1309 displays.
 *
 * Searches for the LCD boot program pattern and changes charge pump
 * initialization bytes from 0x8D 0x14 (SSD1306) to 0xE3 0xE3 (SSD1309 NOP).
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchSSD1309(flashData) {
  let count = 0;

  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN.length; j++) {
      if (flashData[i + j] !== LCD_BOOT_PATTERN[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Replace charge pump bytes (offset +2 and +3 from pattern start)
      flashData[i + 2] = 0xe3; // NOP (was 0x8D — charge pump enable command)
      flashData[i + 3] = 0xe3; // NOP (was 0x14 — charge pump on)
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Patched ${count} LCD boot program(s) for SSD1309.` : 'LCD boot program pattern not found.',
  };
}

/**
 * Patch the contrast/brightness byte in the LCD boot program.
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @param {number} contrast - Contrast value (0x00–0xFF). Common: 0xCF=max, 0x7F=normal, 0x3F=dim, 0x1F=dimmer, 0x00=dimmest
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchContrast(flashData, contrast) {
  let count = 0;

  for (let i = 0; i <= flashData.length - LCD_BOOT_PATTERN.length; i++) {
    let match = true;
    for (let j = 0; j < LCD_BOOT_PATTERN.length; j++) {
      // Allow the charge pump bytes to be already patched (0xE3)
      if (j === 2 || j === 3) continue;
      // Allow the contrast byte to be any value
      if (j === 7) continue;
      if (flashData[i + j] !== LCD_BOOT_PATTERN[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      flashData[i + 7] = contrast; // Contrast byte at offset 7
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Set contrast to 0x${contrast.toString(16)} in ${count} location(s).` : 'LCD boot program pattern not found.',
  };
}

// =============================================================================
// Arduino Micro LED Polarity Patch
// =============================================================================

/** SBI/CBI instruction patterns for RXLED and TXLED */
const RXLED_CBI = new Uint8Array([0x47, 0x9a]); // CBI PORTB, 0 (RXLED off)
const RXLED_SBI = new Uint8Array([0x47, 0x98]); // SBI PORTB, 0 (RXLED on)
const TXLED_CBI = new Uint8Array([0x35, 0x9a]); // CBI PORTD, 5 (TXLED off)
const TXLED_SBI = new Uint8Array([0x35, 0x98]); // SBI PORTD, 5 (TXLED on)

/**
 * Patch LED polarity for Arduino Micro clones.
 * Swaps SBI ↔ CBI instructions for RXLED and TXLED pins.
 *
 * @param {Uint8Array} flashData - Flash data to patch (modified in-place)
 * @returns {{success: boolean, count: number, message: string}}
 */
export function patchMicroLed(flashData) {
  let count = 0;

  for (let i = 0; i <= flashData.length - 2; i++) {
    // RXLED: swap CBI ↔ SBI for PORTB bit 0
    if (flashData[i] === RXLED_CBI[0] && flashData[i + 1] === RXLED_CBI[1]) {
      flashData[i + 1] = RXLED_SBI[1]; // CBI → SBI
      count++;
    } else if (flashData[i] === RXLED_SBI[0] && flashData[i + 1] === RXLED_SBI[1]) {
      flashData[i + 1] = RXLED_CBI[1]; // SBI → CBI
      count++;
    }
    // TXLED: swap CBI ↔ SBI for PORTD bit 5
    if (flashData[i] === TXLED_CBI[0] && flashData[i + 1] === TXLED_CBI[1]) {
      flashData[i + 1] = TXLED_SBI[1]; // CBI → SBI
      count++;
    } else if (flashData[i] === TXLED_SBI[0] && flashData[i + 1] === TXLED_SBI[1]) {
      flashData[i + 1] = TXLED_CBI[1]; // SBI → CBI
      count++;
    }
  }

  return {
    success: count > 0,
    count,
    message: count > 0 ? `Swapped ${count} LED instruction(s) for Micro polarity.` : 'No LED instructions found to patch.',
  };
}

// =============================================================================
// FX Data/Save Page Patching
// =============================================================================

/**
 * Patch FX data and save page addresses into a program binary.
 * Used when building flash cart slots to tell the program where its
 * FX data and save data are located.
 *
 * @param {Uint8Array} program - Program binary (modified in-place)
 * @param {number|null} dataPage - FX data page number (null to skip)
 * @param {number|null} savePage - FX save page number (null to skip)
 */
export function patchFxPages(program, dataPage, savePage) {
  if (program.length < 0x1c) return;

  if (dataPage !== null && dataPage !== undefined) {
    program[FX_DATA_PAGE_OFFSET] = RETI_BYTES[0];
    program[FX_DATA_PAGE_OFFSET + 1] = RETI_BYTES[1];
    writeUint16BE(program, FX_DATA_PAGE_OFFSET + 2, dataPage);
  }

  if (savePage !== null && savePage !== undefined) {
    program[FX_SAVE_PAGE_OFFSET] = RETI_BYTES[0];
    program[FX_SAVE_PAGE_OFFSET + 1] = RETI_BYTES[1];
    writeUint16BE(program, FX_SAVE_PAGE_OFFSET + 2, savePage);
  }
}

// =============================================================================
// Menu Button Patch (Timer0 ISR replacement)
// =============================================================================

/**
 * The menu button patch AVR machine code.
 * Replaces the Timer0 ISR to detect UP+DOWN held for 2 seconds,
 * then jumps to the bootloader menu.
 *
 * This is 152 bytes of AVR machine code that must be placed at the
 * original Timer0 ISR location. It references timer0_millis, timer0_fract,
 * and timer0_overflow_count variables which must be patched with correct
 * addresses from the original ISR.
 *
 * Full implementation deferred to Phase 6 — requires AVR ISR analysis.
 */
export const MENU_BUTTON_PATCH = null; // TODO: Port the 152-byte AVR machine code patch

/**
 * Apply the menu button patch to a program binary.
 * Modifies the Timer0 ISR to detect UP+DOWN held for 2 seconds.
 *
 * @param {Uint8Array} program - Program binary (modified in-place)
 * @returns {{success: boolean, message: string}}
 */
export function patchMenuButtons(program) {
  // TODO: Port the full menu button patch from arduboy_toolset/arduboy/patch.py
  // This requires:
  // 1. Finding the Timer0 ISR vector at address 0x5E in the vector table
  // 2. Analyzing the ISR to find timer0_millis, timer0_fract, timer0_overflow_count addresses
  // 3. Replacing the ISR with the patched version
  // 4. Fixing up variable addresses in the patched code

  return {
    success: false,
    message: 'Menu button patch: not yet implemented in web version.',
  };
}

// =============================================================================
// Contrast Presets
// =============================================================================

/** Common contrast preset values */
export const CONTRAST_PRESETS = {
  MAX:     0xcf,
  NORMAL:  0x7f,
  DIM:     0x3f,
  DIMMER:  0x1f,
  DIMMEST: 0x00,
};
