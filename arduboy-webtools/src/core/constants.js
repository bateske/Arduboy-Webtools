/**
 * Arduboy Hardware & Protocol Constants
 *
 * Consolidated from:
 *   - arduboy_toolset/arduboy/constants.py
 *   - Arduboy-Python-Utilities (various scripts)
 *   - ArduboyWebFlasher/index.html
 */

// =============================================================================
// ATmega32U4 Internal Flash
// =============================================================================

/** Internal flash page size in bytes (SPM page) */
export const FLASH_PAGESIZE = 128;

/** Total internal flash size (32KB) */
export const FLASH_SIZE = 32768;

/** Number of internal flash pages */
export const FLASH_PAGES = FLASH_SIZE / FLASH_PAGESIZE; // 256

/** Caterina bootloader size (4KB) */
export const BOOTLOADER_CATERINA_SIZE = 4096;

/** Cathy3K bootloader size (3KB) */
export const BOOTLOADER_CATHY_SIZE = 3072;

/** Application area size with Caterina bootloader */
export const APP_SIZE_CATERINA = FLASH_SIZE - BOOTLOADER_CATERINA_SIZE; // 28672

/** Application area size with Cathy3K bootloader */
export const APP_SIZE_CATHY = FLASH_SIZE - BOOTLOADER_CATHY_SIZE; // 29696

// =============================================================================
// ATmega32U4 EEPROM
// =============================================================================

/** EEPROM size in bytes */
export const EEPROM_SIZE = 1024;

// =============================================================================
// OLED Display
// =============================================================================

/** Screen width in pixels */
export const SCREEN_WIDTH = 128;

/** Screen height in pixels */
export const SCREEN_HEIGHT = 64;

/** Screen buffer size in bytes (128 * 64 / 8) */
export const SCREEN_BYTES = 1024;

// =============================================================================
// External SPI Flash (FX chip)
// =============================================================================

/** FX flash page size in bytes */
export const FX_PAGESIZE = 256;

/** FX flash block size in bytes (erase unit) */
export const FX_BLOCKSIZE = 65536;

/** Pages per block */
export const FX_PAGES_PER_BLOCK = FX_BLOCKSIZE / FX_PAGESIZE; // 256

/** Maximum pages in 16MB flash */
export const FX_MAX_PAGES = 65536;

/** Full 16MB cart size in bytes */
export const FX_FULL_CART_SIZE = 16777216;

/** Number of 64KB blocks in a full 16MB cart */
export const FX_BLOCKS_PER_CART = FX_FULL_CART_SIZE / FX_BLOCKSIZE; // 256

/** FX save data alignment (4KB) */
export const FX_SAVE_ALIGNMENT = 4096;

// =============================================================================
// FX Cart Header Format (256 bytes per slot header)
// =============================================================================

/** Magic bytes at start of each cart slot header */
export const FX_CART_MAGIC = new Uint8Array([0x41, 0x52, 0x44, 0x55, 0x42, 0x4f, 0x59]); // "ARDUBOY"

/** Header offsets */
export const FX_HEADER = {
  MAGIC:         0x00, // 7 bytes
  CATEGORY:      0x07, // 1 byte
  PREV_PAGE:     0x08, // 2 bytes (big-endian)
  NEXT_PAGE:     0x0A, // 2 bytes (big-endian)
  SLOT_SIZE:     0x0C, // 2 bytes (big-endian, in pages)
  PROGRAM_SIZE:  0x0E, // 1 byte (in 128-byte half-pages)
  PROGRAM_PAGE:  0x0F, // 2 bytes (big-endian)
  DATA_PAGE:     0x11, // 2 bytes (big-endian)
  SAVE_PAGE:     0x13, // 2 bytes (big-endian)
  DATA_SIZE:     0x15, // 2 bytes (big-endian, in pages)
  HASH:          0x19, // 32 bytes (SHA-256)
  META_START:    0x39, // 199 bytes (null-separated strings)
};

/** FX header total size */
export const FX_HEADER_SIZE = 256;

/** Title screen size (follows header) */
export const FX_TITLE_SIZE = SCREEN_BYTES; // 1024

/** Max metadata string length (title\0version\0developer\0info\0) */
export const FX_META_MAX_LENGTH = 199;

// =============================================================================
// FX Program Patch Offsets
// =============================================================================

/** RETI instruction bytes (marker for FX page locations) */
export const RETI_BYTES = new Uint8Array([0x18, 0x95]);

/** Offset for FX data page in program binary */
export const FX_DATA_PAGE_OFFSET = 0x14;

/** Offset for FX save page in program binary */
export const FX_SAVE_PAGE_OFFSET = 0x18;

// =============================================================================
// AVR109 Protocol Commands
// =============================================================================

export const CMD = {
  GET_IDENTIFIER:    0x53, // 'S' — returns 7-byte string
  GET_VERSION:       0x56, // 'V' — returns 2 ASCII bytes
  ENTER_PROGRAMMING: 0x50, // 'P' — returns 0x0D
  LEAVE_PROGRAMMING: 0x4C, // 'L' — returns 0x0D
  EXIT_BOOTLOADER:   0x45, // 'E' — returns 0x0D, starts app
  READ_LOCK_BITS:    0x72, // 'r' — returns 1 byte
  SET_ADDRESS:       0x41, // 'A' + 2 bytes — returns 0x0D
  BLOCK_WRITE:       0x42, // 'B' + 2 bytes len + type + data — returns 0x0D
  BLOCK_READ:        0x67, // 'g' + 2 bytes len + type — returns data
  GET_JEDEC_ID:      0x6A, // 'j' — returns 3 bytes (Cathy3K 1.3+)
  LED_CONTROL:       0x78, // 'x' + 1 byte flags — returns 0x0D
  SELECT_CART_SLOT:  0x54, // 'T' + 1 byte — returns 0x0D
};

/** Memory type codes for block read/write */
export const MEM_TYPE = {
  FLASH:  0x46, // 'F' — internal flash
  EEPROM: 0x45, // 'E' — EEPROM
  FX:     0x43, // 'C' — external FX flash cart
};

/** ACK byte returned by most commands */
export const ACK = 0x0D;

/** Cathy3K minimum version for FX support */
export const CATHY3K_MIN_VERSION = 13;

// =============================================================================
// LED Control Flags (x command)
// =============================================================================

export const LED = {
  BLUE:              0x01,
  RED:               0x02,
  GREEN:             0x04,
  TX_LED:            0x08,
  RX_LED:            0x10,
  RXTX_STATUS_OFF:   0x20,
  BUTTONS_DISABLED:  0xC0, // Bits 7+6
};

/** Common LED presets */
export const LED_PRESET = {
  RED_LOCKED:   0xC2, // RED + buttons disabled (writing)
  BLUE_LOCKED:  0xC1, // BLUE + buttons disabled (verifying)
  OFF_LOCKED:   0xC0, // LEDs off + buttons disabled
  GREEN_ACTIVE: 0x44, // GREEN + buttons enabled (success)
  OFF_ACTIVE:   0x40, // LEDs off + buttons enabled
};

// =============================================================================
// USB Device Identifiers
// =============================================================================

/**
 * USB VID:PID filters for Web Serial API.
 * Pairs: [bootloader, application] for each device variant.
 */
export const USB_FILTERS = [
  // Arduino Leonardo
  { usbVendorId: 0x2341, usbProductId: 0x0036 }, // bootloader
  { usbVendorId: 0x2341, usbProductId: 0x8036 }, // application
  // Arduino Leonardo (alternate vendor)
  { usbVendorId: 0x2A03, usbProductId: 0x0036 },
  { usbVendorId: 0x2A03, usbProductId: 0x8036 },
  // Arduino Micro
  { usbVendorId: 0x2341, usbProductId: 0x0037 },
  { usbVendorId: 0x2341, usbProductId: 0x8037 },
  // Arduino Micro (alternate vendor)
  { usbVendorId: 0x2A03, usbProductId: 0x0037 },
  { usbVendorId: 0x2A03, usbProductId: 0x8037 },
  // Genuino Micro
  { usbVendorId: 0x2341, usbProductId: 0x0237 },
  { usbVendorId: 0x2341, usbProductId: 0x8237 },
  // SparkFun Pro Micro 5V
  { usbVendorId: 0x1B4F, usbProductId: 0x9205 },
  { usbVendorId: 0x1B4F, usbProductId: 0x9206 },
  // Adafruit ItsyBitsy 5V
  { usbVendorId: 0x239A, usbProductId: 0x000E },
  { usbVendorId: 0x239A, usbProductId: 0x800E },
];

/**
 * Check if a USB filter represents a bootloader-mode device.
 * Even indices in USB_FILTERS are bootloader, odd are application.
 */
export function isBootloaderFilter(filter) {
  const idx = USB_FILTERS.findIndex(
    (f) => f.usbVendorId === filter.usbVendorId && f.usbProductId === filter.usbProductId
  );
  return idx >= 0 && idx % 2 === 0;
}

// =============================================================================
// Device Types
// =============================================================================

export const DEVICE_TYPE = {
  ARDUBOY: 'Arduboy',
  ARDUBOY_FX: 'ArduboyFX',
  ARDUBOY_MINI: 'ArduboyMini',
};

/** SPI chip-select byte patterns for device detection in sketch binaries */
export const DEVICE_DETECT = {
  FX_ENABLE:   [0x59, 0x98], // Port E bit 2 = FX chip select
  FX_DISABLE:  [0x59, 0x9A],
  MINI_ENABLE: [0x72, 0x98], // Port D bit 1 = Mini chip select
  MINI_DISABLE:[0x72, 0x9A],
};

// =============================================================================
// JEDEC Manufacturer IDs
// =============================================================================

export const JEDEC_MANUFACTURERS = {
  0xEF: 'Winbond',
  0xC8: 'GigaDevice',
  0x9D: 'ISSI',
  0xBF: 'Microchip',
  0x01: 'Cypress/Spansion',
  0x20: 'Micron',
  0xC2: 'Macronix',
  0x1F: 'Adesto/Atmel',
};

// =============================================================================
// FX Data Build Constants (Drawing Modes)
// =============================================================================

export const DRAW_MODE = {
  dbmNormal:  0x00,
  dbmOverwrite: 0x00,
  dbmWhite:   0x01,
  dbmInvert:  0x02,
  dbmBlack:   0x0D,
  dbmMasked:  0x10,
};

// =============================================================================
// .arduboy Package Schema
// =============================================================================

export const ARDUBOY_SCHEMA_VERSION = 4;
