/**
 * Parser for fxdata.txt files.
 *
 * Closely replicates the tokenization and parsing behavior of
 * fxdata-build.py version 1.15 by Mr.Blinky.
 *
 * The parser is intentionally loose — it strips C-like punctuation,
 * tolerates semicolons, braces, etc. and processes a state-machine
 * driven by the current data type.
 */

import { FX_PREDEFINED_CONSTANTS } from './fxdataSymbols.js';

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Diagnostic
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} message
 * @property {string} file
 * @property {number} line
 * @property {string} [token]
 */

// ---------------------------------------------------------------------------
// Data type enum — matches Python's t values
// ---------------------------------------------------------------------------

/** @enum {number} */
const TYPE = {
  ALIGN:    0,
  UINT8:    1,
  UINT16:   2,
  UINT24:   3,
  UINT32:   4,
  IMAGE:    5,
  RAW:      6,
  STRING:   7,
  NONE:     -1,
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split a line into tokens, matching Python's regex:
 *   re.split("([ ,]|[\\'].*[\\'])", line)
 * Then filter out empty strings and lone commas.
 *
 * This preserves quoted strings (single or double) as single tokens.
 *
 * @param {string} line
 * @returns {string[]}
 */
function tokenizeLine(line) {
  // Match: quoted strings (single or double), or sequences of non-space non-comma chars
  const tokens = [];
  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^ ,\t\r\n]+)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * Strip unwanted characters from a token, matching the Python behavior:
 *   if part[:1]  == '\t' : part = part[1:]
 *   if part[:1]  == '{' : part = part[1:]
 *   if part[-1:] == '\n': part = part[:-1]
 *   if part[-1:] == ';' : part = part[:-1]
 *   if part[-1:] == '}' : part = part[:-1]
 *   if part[-1:] == ';' : part = part[:-1]
 *   if part[-1:] == '.' : part = part[:-1]
 *   if part[-1:] == ',' : part = part[:-1]
 *   if part[-2:] == '[]': part = part[:-2]
 *
 * @param {string} part
 * @returns {string}
 */
function stripToken(part) {
  if (part.length === 0) return part;
  // Leading strips
  if (part[0] === '\t') part = part.slice(1);
  if (part.length > 0 && part[0] === '{') part = part.slice(1);
  // Trailing strips (in exact Python order)
  if (part.length > 0 && part[part.length - 1] === '\n') part = part.slice(0, -1);
  if (part.length > 0 && part[part.length - 1] === ';') part = part.slice(0, -1);
  if (part.length > 0 && part[part.length - 1] === '}') part = part.slice(0, -1);
  if (part.length > 0 && part[part.length - 1] === ';') part = part.slice(0, -1);
  if (part.length > 0 && part[part.length - 1] === '.') part = part.slice(0, -1);
  if (part.length > 0 && part[part.length - 1] === ',') part = part.slice(0, -1);
  if (part.length >= 2 && part.slice(-2) === '[]') part = part.slice(0, -2);
  return part;
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ParseResult
 * @property {Uint8Array} bytes - Accumulated binary data
 * @property {Array<{ name: string, offset: number }>} symbols - Labels in definition order
 * @property {string[]} headerLines - Lines for fxdata.h body (symbols, namespaces, etc.)
 * @property {number} saveStart - Byte offset where save section starts (-1 if none)
 * @property {Diagnostic[]} diagnostics
 * @property {MemoryMapEntry[]} memoryMap
 */

/**
 * @typedef {Object} MemoryMapEntry
 * @property {string} name
 * @property {number} offset
 * @property {number} size
 * @property {string} type - 'image' | 'data' | 'raw' | 'string' | 'align' | 'save'
 * @property {string} file
 * @property {number} line
 */

/**
 * Parse and build FX data from source text.
 *
 * This function combines parsing with binary emission in a single pass,
 * exactly like the Python reference does. This ensures identical offset
 * calculations and symbol values.
 *
 * @param {string} sourceText - Content of the entry fxdata.txt file
 * @param {string} filename - Path/name of the entry file
 * @param {Object} callbacks
 * @param {function(string, string): string|null} callbacks.resolveInclude
 *   (includePath, fromFile) => file content string, or null if not found
 * @param {function(string, string, Object): Promise<{bytes: Uint8Array, width: number, height: number, frames: number, hasTransparency: boolean}>} callbacks.resolveImage
 *   (imagePath, fromFile, options) => encoded image data
 * @param {function(string, string): Uint8Array|null} callbacks.resolveRaw
 *   (rawPath, fromFile) => raw file bytes, or null if not found
 * @param {Object} [options]
 * @param {number} [options.threshold=128] - Image brightness threshold
 * @returns {Promise<ParseResult>}
 */
export async function parseFxData(sourceText, filename, callbacks, options = {}) {
  const threshold = options.threshold ?? 128;
  const diagnostics = [];
  const symbols = [];
  const headerLines = [];
  const memoryMap = [];

  // Binary accumulator — start with a resizable approach
  let bytesList = [];
  let bytesLength = 0;

  function appendBytes(data) {
    if (data instanceof Uint8Array) {
      bytesList.push(data);
      bytesLength += data.length;
    } else if (Array.isArray(data)) {
      const arr = new Uint8Array(data);
      bytesList.push(arr);
      bytesLength += arr.length;
    }
  }

  function appendByte(b) {
    bytesList.push(new Uint8Array([b & 0xFF]));
    bytesLength++;
  }

  function finalizeBytes() {
    const result = new Uint8Array(bytesLength);
    let offset = 0;
    for (const chunk of bytesList) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // State
  let t = TYPE.NONE;
  let blkcom = false;
  let pendingNamespace = false;
  let pendingInclude = false;
  let indent = '';
  let label = '';
  let saveStart = -1;

  // Track the current entry for memory map
  let currentEntryStart = -1;
  let currentEntryName = '';
  let currentEntryType = '';
  let pendingNumericEntry = null;

  function flushPendingNumericEntry() {
    if (pendingNumericEntry) {
      memoryMap.push(pendingNumericEntry);
      pendingNumericEntry = null;
      currentEntryStart = -1;
      currentEntryName = '';
      currentEntryType = '';
    }
  }

  function addLabel(name, offset, type = null) {
    flushPendingNumericEntry();
    symbols.push({ name, offset });

    // Add usage example comment based on data type (skip images — handled after resolution)
    if (type !== TYPE.IMAGE) {
      const example = getUsageExample(name, type);
      if (example) {
        headerLines.push(`${indent}// ${example}`);
      }
    }

    headerLines.push(`${indent}constexpr uint24_t ${name} = 0x${offset.toString(16).padStart(6, '0').toUpperCase()};`);
    // Track entry for memory map
    currentEntryStart = offset;
    currentEntryName = name;
    currentEntryType = type;
  }

  function writeHeader(s) {
    headerLines.push(s);
  }

  // Build line list with file tracking
  const lines = sourceText.split('\n').map((text, i) => ({
    text,
    file: filename,
    lineNr: i + 1,
  }));

  let lineIdx = 0;
  while (lineIdx < lines.length) {
    const lineInfo = lines[lineIdx];
    const rawLine = lineInfo.text;
    const currentFile = lineInfo.file;
    const currentLineNr = lineInfo.lineNr;

    const parts = tokenizeLine(rawLine);

    for (let i = 0; i < parts.length; i++) {
      let part = stripToken(parts[i]);

      // Skip empty tokens
      if (part.length === 0) continue;

      // Handle block comments
      if (blkcom) {
        const p = part.indexOf('*/', 0);
        if (p >= 0) {
          part = part.slice(p + 2);
          blkcom = false;
          if (part.length === 0) continue;
        } else {
          continue;
        }
      }

      // Line comment
      if (part.startsWith('//')) {
        break; // Skip rest of line
      }

      // Block comment start
      if (part.startsWith('/*')) {
        const p = part.indexOf('*/', 2);
        if (p >= 0) {
          part = part.slice(p + 2);
          if (part.length === 0) continue;
        } else {
          blkcom = true;
          continue;
        }
      }

      // Type keywords and directives
      if (part === '=')        { continue; }
      if (part === 'const')    { continue; }
      if (part === 'PROGMEM')  { continue; }

      // Flush any pending numeric array entry before starting a new type
      if (part === 'align' || part === 'int8_t' || part === 'uint8_t' ||
          part === 'int16_t' || part === 'uint16_t' || part === 'int24_t' || part === 'uint24_t' ||
          part === 'int32_t' || part === 'uint32_t' || part === 'image_t' || part === 'raw_t' ||
          part === 'String' || part === 'string' || part === 'datasection' || part === 'savesection') {
        flushPendingNumericEntry();
      }

      if (part === 'align')    { t = TYPE.ALIGN; continue; }
      if (part === 'int8_t' || part === 'uint8_t')   { t = TYPE.UINT8; continue; }
      if (part === 'int16_t' || part === 'uint16_t')  { t = TYPE.UINT16; continue; }
      if (part === 'int24_t' || part === 'uint24_t')  { t = TYPE.UINT24; continue; }
      if (part === 'int32_t' || part === 'uint32_t')  { t = TYPE.UINT32; continue; }
      if (part === 'image_t')  { t = TYPE.IMAGE; continue; }
      if (part === 'raw_t')    { t = TYPE.RAW; continue; }
      if (part === 'String' || part === 'string') { t = TYPE.STRING; continue; }

      if (part === 'include')  { pendingInclude = true; continue; }
      if (part === 'datasection') {
        memoryMap.push({
          name: '(data section start)',
          offset: bytesLength,
          size: 0,
          type: 'datasection',
          file: currentFile,
          line: currentLineNr,
        });
        continue;
      }

      if (part === 'savesection') {
        saveStart = bytesLength;
        memoryMap.push({
          name: '(save section start)',
          offset: bytesLength,
          size: 0,
          type: 'save',
          file: currentFile,
          line: currentLineNr,
        });
        continue;
      }

      // Namespace handling
      if (part === 'namespace') {
        pendingNamespace = true;
        continue;
      }
      if (pendingNamespace) {
        pendingNamespace = false;
        writeHeader(`${indent}namespace ${part}\n${indent}{`);
        indent += '  ';
        continue;
      }
      if (part === 'namespace_end') {
        indent = indent.slice(0, -2);
        writeHeader(`${indent}}\n`);
        continue;
      }

      // Quoted strings
      if (part[0] === "'" || part[0] === '"') {
        const quote = part[0];
        const inner = part.slice(1, part.lastIndexOf(quote));

        // Handle include
        if (pendingInclude) {
          const includeContent = callbacks.resolveInclude(inner, currentFile);
          if (includeContent === null || includeContent === undefined) {
            diagnostics.push({
              severity: 'error',
              message: `Include file not found: ${inner}`,
              file: currentFile,
              line: currentLineNr,
              token: inner,
            });
          } else {
            // Insert included lines right after the current line
            const includedLines = includeContent.split('\n').map((text, idx) => ({
              text,
              file: inner,
              lineNr: idx + 1,
            }));
            lines.splice(lineIdx + 1, 0, ...includedLines);
          }
          pendingInclude = false;
          continue;
        }

        // Process string based on current type
        if (t === TYPE.UINT8) {
          // Raw bytes from string (with escape processing)
          const processed = processEscapes(inner);
          const encoded = new TextEncoder().encode(processed);
          appendBytes(encoded);
        } else if (t === TYPE.IMAGE) {
          // Image file reference
          const entryStart = bytesLength;
          try {
            const result = await callbacks.resolveImage(inner, currentFile, { threshold });
            appendBytes(result.bytes);

            // Add image usage example and dimension constants to header
            const lastSymbol = symbols.length > 0 ? symbols[symbols.length - 1] : null;
            if (lastSymbol) {
              // Insert usage example comment before the constexpr line for this label
              const mode = result.hasTransparency ? 'dbmMasked' : 'dbmNormal';
              const exampleComment = `${indent}// FX::drawBitmap(x, y, ${lastSymbol.name}, frame, ${mode});`;
              const constIdx = headerLines.lastIndexOf(
                `${indent}constexpr uint24_t ${lastSymbol.name} = 0x${lastSymbol.offset.toString(16).padStart(6, '0').toUpperCase()};`
              );
              if (constIdx >= 0) {
                headerLines.splice(constIdx, 0, exampleComment);
              }

              const { widthName, heightName, framesName, framesType } =
                getImageConstantNamesFromLabel(lastSymbol.name, result.frames);
              writeHeader(`${indent}constexpr uint16_t ${widthName}  = ${result.width};`);
              writeHeader(`${indent}constexpr uint16_t ${heightName} = ${result.height};`);
              if (result.frames > 1) {
                writeHeader(`${indent}constexpr ${framesType}  ${framesName} = ${result.frames};`);
              }
              writeHeader('');
            }

            // Memory map entry
            if (lastSymbol) {
              memoryMap.push({
                name: lastSymbol.name,
                offset: entryStart,
                size: result.bytes.length,
                type: 'image',
                file: currentFile,
                line: currentLineNr,
                assetPath: inner,
              });
            }
          } catch (err) {
            diagnostics.push({
              severity: 'error',
              message: `Image error: ${inner} — ${err.message}`,
              file: currentFile,
              line: currentLineNr,
              token: inner,
            });
          }
        } else if (t === TYPE.RAW) {
          // Raw binary file reference
          const entryStart = bytesLength;
          const rawBytes = callbacks.resolveRaw(inner, currentFile);
          if (rawBytes === null || rawBytes === undefined) {
            diagnostics.push({
              severity: 'error',
              message: `Raw file not found: ${inner}`,
              file: currentFile,
              line: currentLineNr,
              token: inner,
            });
          } else {
            appendBytes(rawBytes);
            const lastSymbol = symbols.length > 0 ? symbols[symbols.length - 1] : null;
            if (lastSymbol) {
              memoryMap.push({
                name: lastSymbol.name,
                offset: entryStart,
                size: rawBytes.length,
                type: 'raw',
                file: currentFile,
                line: currentLineNr,
                assetPath: inner,
              });
            }
          }
        } else if (t === TYPE.STRING) {
          // Null-terminated string
          const entryStart = bytesLength;
          const processed = processEscapes(inner);
          const encoded = new TextEncoder().encode(processed);
          appendBytes(encoded);
          appendByte(0x00); // null terminator
          const lastSymbol = symbols.length > 0 ? symbols[symbols.length - 1] : null;
          if (lastSymbol) {
            memoryMap.push({
              name: lastSymbol.name,
              offset: entryStart,
              size: encoded.length + 1,
              type: 'string',
              file: currentFile,
              line: currentLineNr,
            });
          }
        } else {
          diagnostics.push({
            severity: 'error',
            message: `Unsupported string for current type`,
            file: currentFile,
            line: currentLineNr,
            token: part,
          });
        }
        continue;
      }

      // Numeric values
      if (/^-?\d/.test(part)) {
        const n = parseIntAuto(part);
        if (isNaN(n)) {
          diagnostics.push({
            severity: 'error',
            message: `Invalid numeric value: ${part}`,
            file: currentFile,
            line: currentLineNr,
            token: part,
          });
          continue;
        }

        // Calculate bytes before appending
        const byteLengthBefore = bytesLength;
        let numBytes = 0;

        // Emit bytes based on current type width (big-endian, matching Python)
        if (t === TYPE.UINT32) { appendByte((n >> 24) & 0xFF); numBytes = 4; }
        if (t >= TYPE.UINT24)  { appendByte((n >> 16) & 0xFF); if (numBytes === 0) numBytes = 3; }
        if (t >= TYPE.UINT16)  { appendByte((n >> 8) & 0xFF); if (numBytes === 0) numBytes = 2; }
        if (t >= TYPE.UINT8)   { appendByte(n & 0xFF); if (numBytes === 0) numBytes = 1; }

        // Track memoryMap entry for numeric data associated with a label.
        // For arrays (multiple values under one label), we defer finalizing
        // the entry so it accumulates the total byte size.
        if ((t === TYPE.UINT8 || t === TYPE.UINT16 || t === TYPE.UINT24 || t === TYPE.UINT32) &&
            currentEntryName !== '' && currentEntryStart >= 0) {
          // Mark that we have a pending numeric memory map entry
          if (!pendingNumericEntry) {
            pendingNumericEntry = {
              name: currentEntryName,
              offset: currentEntryStart,
              size: numBytes,
              type: 'data',
              file: currentFile,
              line: currentLineNr,
            };
          } else {
            // Extend the pending entry with additional array element bytes
            pendingNumericEntry.size = bytesLength - pendingNumericEntry.offset;
          }
        }

        // Handle align
        if (t === TYPE.ALIGN) {
          const align = bytesLength % n;
          if (align > 0) {
            const padSize = n - align;
            const padStart = bytesLength;
            const pad = new Uint8Array(padSize).fill(0xFF);
            appendBytes(pad);
            memoryMap.push({
              name: `(alignment padding to ${n})`,
              offset: padStart,
              size: padSize,
              type: 'align',
              file: currentFile,
              line: currentLineNr,
            });
          }
        }
        continue;
      }

      // Labels and symbol references
      if (/^[a-zA-Z_]/.test(part)) {
        label = '';
        // Accumulate label characters, checking for embedded '='
        let foundEquals = false;
        for (let j = 0; j < part.length; j++) {
          if (part[j] === '=') {
            foundEquals = true;
            addLabel(label, bytesLength, t);
            label = '';
            const remainder = part.slice(j + 1);
            if (remainder.length > 0) {
              // Re-insert remainder for processing
              parts.splice(i + 1, 0, remainder);
            }
            break;
          } else if (/[a-zA-Z0-9_]/.test(part[j])) {
            label += part[j];
          } else {
            diagnostics.push({
              severity: 'error',
              message: `Bad label character: ${part[j]} in ${part}`,
              file: currentFile,
              line: currentLineNr,
              token: part,
            });
            label = '';
            break;
          }
        }

        if (foundEquals) {
          label = '';
          continue;
        }

        // Check if next token is '='
        if (label !== '' && i < parts.length - 1) {
          const nextPart = stripToken(parts[i + 1]);
          if (nextPart.startsWith('=')) {
            addLabel(label, bytesLength, t);
            label = '';
            // If '=' has trailing content, re-insert it
            if (nextPart.length > 1) {
              parts[i + 1] = nextPart.slice(1);
            } else {
              i++; // Skip the '=' token
            }
            continue;
          }
        }

        // Try to resolve as a predefined constant
        if (label !== '') {
          const predefined = FX_PREDEFINED_CONSTANTS.get(label);
          if (predefined !== undefined) {
            if (t === TYPE.UINT32) appendByte((predefined >> 24) & 0xFF);
            if (t >= TYPE.UINT24)  appendByte((predefined >> 16) & 0xFF);
            if (t >= TYPE.UINT16)  appendByte((predefined >> 8) & 0xFF);
            if (t >= TYPE.UINT8)   appendByte(predefined & 0xFF);
            label = '';
            continue;
          }
        }

        // Try to resolve as a user-defined symbol
        if (label !== '') {
          const sym = symbols.find((s) => s.name === label);
          if (sym) {
            if (t === TYPE.UINT32) appendByte((sym.offset >> 24) & 0xFF);
            if (t >= TYPE.UINT24)  appendByte((sym.offset >> 16) & 0xFF);
            if (t >= TYPE.UINT16)  appendByte((sym.offset >> 8) & 0xFF);
            if (t >= TYPE.UINT8)   appendByte(sym.offset & 0xFF);
            label = '';
            continue;
          }
        }

        // Unresolved — if we have no type set, it could be a forward label
        // that will get '=' on a future token. Otherwise it's an error.
        if (label !== '' && t !== TYPE.NONE) {
          diagnostics.push({
            severity: 'error',
            message: `Undefined symbol: ${label}`,
            file: currentFile,
            line: currentLineNr,
            token: label,
          });
          label = '';
        }
        continue;
      }

      // Anything else that has content
      if (part.length > 0) {
        diagnostics.push({
          severity: 'error',
          message: `Unable to parse: ${part}`,
          file: currentFile,
          line: currentLineNr,
          token: part,
        });
      }
    }

    lineIdx++;
  }

  // Flush any trailing pending numeric entry
  flushPendingNumericEntry();

  return {
    bytes: finalizeBytes(),
    symbols,
    headerLines,
    saveStart,
    diagnostics,
    memoryMap,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an integer supporting decimal, hex (0x), octal (0), and binary (0b).
 * Matches Python's int(part, 0) behavior.
 * @param {string} s
 * @returns {number}
 */
function parseIntAuto(s) {
  s = s.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
  if (s.startsWith('0b') || s.startsWith('0B')) return parseInt(s.slice(2), 2);
  if (s.startsWith('-')) return -parseIntAuto(s.slice(1));
  // Note: Python int('010', 0) = 8 (octal), but this is rarely used in fxdata
  return parseInt(s, 10);
}

/**
 * Process C-style escape sequences in a string.
 * Matches Python's .encode('utf-8').decode('unicode_escape').encode('utf-8')
 * for the common escape sequences used in fxdata files.
 * @param {string} s
 * @returns {string}
 */
function processEscapes(s) {
  return s.replace(/\\([nrtv0\\'"abf]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (match, esc) => {
    switch (esc[0]) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'v': return '\v';
      case '0': return '\0';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'x': return String.fromCharCode(parseInt(esc.slice(1), 16));
      case 'u': return String.fromCodePoint(parseInt(esc.slice(1), 16));
      default: return match;
    }
  });
}

/**
 * Get a usage example comment for a data type.
 * Returns null if no example is appropriate (e.g. for images, handled separately).
 * @param {string} name - Symbol name
 * @param {number|null} type - TYPE enum value
 * @returns {string|null}
 */
function getUsageExample(name, type) {
  switch (type) {
    case TYPE.UINT8:
      return `FX::readIndexedUInt8(${name}, index);`;
    case TYPE.UINT16:
      return `FX::readIndexedUInt16(${name}, index);`;
    case TYPE.UINT24:
      return `FX::readIndexedUInt24(${name}, index);`;
    case TYPE.UINT32:
      return `FX::readIndexedUInt32(${name}, index);`;
    case TYPE.STRING:
      return `FX::drawString(${name});`;
    case TYPE.RAW:
      return `FX::readDataBytes(${name}, buffer, length);`;
    default:
      return null;
  }
}

/**
 * Get image constant naming convention.
 * Matches fxdata-build.py logic for generating Width/Height/Frames constant names.
 */
function getImageConstantNamesFromLabel(label, frames) {
  if (label === label.toUpperCase() && label.length > 0) {
    return {
      widthName: `${label}_WIDTH`,
      heightName: `${label}HEIGHT`,
      framesName: `${label}_FRAMES`,
      framesType: 'uint8_t',
    };
  } else if (label.includes('_')) {
    return {
      widthName: `${label}_width`,
      heightName: `${label}_height`,
      framesName: `${label}_frames`,
      framesType: 'uint8_t',
    };
  } else {
    return {
      widthName: `${label}Width`,
      heightName: `${label}Height`,
      framesName: `${label}Frames`,
      framesType: frames > 255 ? 'uint16_t' : 'uint8_t',
    };
  }
}
