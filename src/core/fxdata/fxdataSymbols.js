/**
 * Symbol table and predefined constants for the FX data builder.
 *
 * Replicates the `constants` list from fxdata-build.py and provides
 * a symbol table for tracking user-defined labels during parsing.
 */

// ---------------------------------------------------------------------------
// Predefined drawing-mode constants (from fxdata-build.py)
// ---------------------------------------------------------------------------

/** @type {Map<string, number>} */
export const FX_PREDEFINED_CONSTANTS = new Map([
  // Normal bitmap modes
  ['dbmNormal',    0x00],
  ['dbmOverwrite', 0x00],
  ['dbmWhite',     0x01],
  ['dbmReverse',   0x08],
  ['dbmBlack',     0x0D],
  ['dbmInvert',    0x02],

  // Masked bitmap modes
  ['dbmMasked',              0x10],
  ['dbmMasked_dbmWhite',     0x11],
  ['dbmMasked_dbmReverse',   0x18],
  ['dbmMasked_dbmBlack',     0x1D],
  ['dbmMasked_dbmInvert',    0x12],

  // Bitmap modes for last bitmap in a frame (_end)
  ['dbmNormal_end',    0x40],
  ['dbmOverwrite_end', 0x40],
  ['dbmWhite_end',     0x41],
  ['dbmReverse_end',   0x48],
  ['dbmBlack_end',     0x4D],
  ['dbmInvert_end',    0x42],

  // Masked bitmap modes for last bitmap in a frame (_end)
  ['dbmMasked_end',              0x50],
  ['dbmMasked_dbmWhite_end',     0x51],
  ['dbmMasked_dbmReverse_end',   0x58],
  ['dbmMasked_dbmBlack_end',     0x5D],
  ['dbmMasked_dbmInvert_end',    0x52],

  // Bitmap modes for last bitmap of the last frame (_last)
  ['dbmNormal_last',    0x80],
  ['dbmOverwrite_last', 0x80],
  ['dbmWhite_last',     0x81],
  ['dbmReverse_last',   0x88],
  ['dbmBlack_last',     0x8D],
  ['dbmInvert_last',    0x82],

  // Masked bitmap modes for last bitmap of the last frame (_last)
  ['dbmMasked_last',              0x90],
  ['dbmMasked_dbmWhite_last',     0x91],
  ['dbmMasked_dbmReverse_last',   0x98],
  ['dbmMasked_dbmBlack_last',     0x9D],
  ['dbmMasked_dbmInvert_last',    0x92],
]);

// ---------------------------------------------------------------------------
// Symbol table
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SymbolEntry
 * @property {string} name
 * @property {number} value - Byte offset (or constant value)
 * @property {'user' | 'predefined'} source
 * @property {string} [file] - Source file where defined
 * @property {number} [line] - Line number where defined
 */

export class SymbolTable {
  constructor() {
    /** @type {SymbolEntry[]} User-defined symbols in definition order */
    this._userSymbols = [];
    /** @type {Map<string, SymbolEntry>} Fast lookup for user symbols */
    this._userMap = new Map();
  }

  /**
   * Define a user symbol (label) at a given offset.
   * @param {string} name
   * @param {number} value - Byte offset in data section
   * @param {string} [file] - Source file
   * @param {number} [line] - Source line number
   * @returns {{ success: boolean, error?: string }}
   */
  define(name, value, file, line) {
    if (this._userMap.has(name)) {
      return { success: false, error: `Duplicate symbol: ${name}` };
    }
    const entry = { name, value, source: 'user', file, line };
    this._userSymbols.push(entry);
    this._userMap.set(name, entry);
    return { success: true };
  }

  /**
   * Resolve a symbol name. Checks predefined constants first, then user symbols.
   * @param {string} name
   * @returns {SymbolEntry | null}
   */
  resolve(name) {
    // Check predefined constants
    if (FX_PREDEFINED_CONSTANTS.has(name)) {
      return { name, value: FX_PREDEFINED_CONSTANTS.get(name), source: 'predefined' };
    }
    // Check user-defined symbols
    return this._userMap.get(name) || null;
  }

  /**
   * Check if a symbol is defined.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return FX_PREDEFINED_CONSTANTS.has(name) || this._userMap.has(name);
  }

  /**
   * Get all user-defined symbols in definition order.
   * @returns {SymbolEntry[]}
   */
  getUserSymbols() {
    return [...this._userSymbols];
  }

  /**
   * Get all symbols (predefined + user).
   * @returns {SymbolEntry[]}
   */
  getAll() {
    const predefined = [...FX_PREDEFINED_CONSTANTS.entries()].map(
      ([name, value]) => ({ name, value, source: 'predefined' }),
    );
    return [...predefined, ...this._userSymbols];
  }

  /** Reset user-defined symbols (keeps predefined). */
  reset() {
    this._userSymbols = [];
    this._userMap = new Map();
  }
}
