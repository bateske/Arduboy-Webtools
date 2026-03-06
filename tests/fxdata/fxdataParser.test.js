/**
 * Tests for the FX Data Parser.
 *
 * Tests tokenization, type handling, numeric encoding, string handling,
 * include directives, namespaces, save sections, and symbol resolution.
 */

import { describe, it, expect } from 'vitest';
import { parseFxData } from '../../src/core/fxdata/fxdataParser.js';

// Mock callbacks that return null/empty for everything (no real files)
const nullCallbacks = {
  resolveInclude: () => null,
  resolveImage: async () => { throw new Error('No image resolver'); },
  resolveRaw: () => null,
};

/**
 * Helper: create callbacks with a set of virtual files.
 */
function makeCallbacks(files = {}) {
  return {
    resolveInclude(path) {
      return files[path] ?? null;
    },
    async resolveImage() {
      throw new Error('Image loading not supported in Node tests');
    },
    resolveRaw(path) {
      return files[path] ?? null;
    },
  };
}

describe('parseFxData', () => {
  describe('comments', () => {
    it('should skip single-line comments', async () => {
      const source = `// this is a comment
uint8_t myData = 0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes.length).toBe(1);
      expect(result.bytes[0]).toBe(0x42);
    });

    it('should skip block comments', async () => {
      const source = `/* this is
a block comment */
uint8_t myData = 0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes.length).toBe(1);
      expect(result.bytes[0]).toBe(0x42);
    });

    it('should handle inline block comments', async () => {
      const source = `uint8_t /* comment */ myData = 0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes.length).toBe(1);
      expect(result.bytes[0]).toBe(0x42);
    });
  });

  describe('data types', () => {
    it('should parse uint8_t values', async () => {
      const source = `uint8_t data = 0xFF 0x00 42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0xFF, 0x00, 42]));
    });

    it('should parse uint16_t values (big-endian)', async () => {
      const source = `uint16_t data = 0x1234`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0x12, 0x34]));
    });

    it('should parse uint24_t values (big-endian)', async () => {
      const source = `uint24_t data = 0x123456`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0x12, 0x34, 0x56]));
    });

    it('should parse uint32_t values (big-endian)', async () => {
      const source = `uint32_t data = 0x12345678`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
    });

    it('should handle multiple values on the same line', async () => {
      const source = `uint8_t data = 1 2 3 4 5`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it('should persist type across lines', async () => {
      const source = `uint8_t data = 1 2
3 4`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should handle negative values', async () => {
      const source = `int16_t val = -1`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      // -1 as signed 16-bit = 0xFFFF big-endian
      expect(result.bytes).toEqual(new Uint8Array([0xFF, 0xFF]));
    });
  });

  describe('labels / symbols', () => {
    it('should define labels with = separator', async () => {
      const source = `uint8_t myLabel = 0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.symbols).toEqual([{ name: 'myLabel', offset: 0 }]);
    });

    it('should define labels with embedded =', async () => {
      const source = `uint8_t myLabel=0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.symbols).toEqual([{ name: 'myLabel', offset: 0 }]);
    });

    it('should track multiple symbols at correct offsets', async () => {
      const source = `uint8_t first = 0xFF
uint16_t second = 0x1234
uint8_t third = 0xAB`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.symbols).toEqual([
        { name: 'first', offset: 0 },
        { name: 'second', offset: 1 },
        { name: 'third', offset: 3 },
      ]);
    });

    it('should generate header lines for each label', async () => {
      const source = `uint8_t myData = 0x42`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.headerLines.length).toBeGreaterThan(0);
      expect(result.headerLines[0]).toContain('myData');
      expect(result.headerLines[0]).toContain('0x000000');
    });
  });

  describe('strings', () => {
    it('should encode String type with null terminator', async () => {
      const source = `string hello = "Hi"`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      // "Hi" = [0x48, 0x69] + null = [0x48, 0x69, 0x00]
      expect(result.bytes).toEqual(new Uint8Array([0x48, 0x69, 0x00]));
    });

    it('should handle escape sequences in strings', async () => {
      const source = `string msg = "A\\nB"`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      // "A\nB" = [0x41, 0x0A, 0x42, 0x00]
      expect(result.bytes).toEqual(new Uint8Array([0x41, 0x0A, 0x42, 0x00]));
    });
  });

  describe('C-like syntax tolerance', () => {
    it('should ignore const, PROGMEM, and semicolons', async () => {
      const source = `const uint8_t PROGMEM data[] = {
  0x01, 0x02, 0x03
};`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
    });

    it('should strip [] from array declarations', async () => {
      const source = `uint8_t myArray[] = 1 2 3`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.symbols).toEqual([{ name: 'myArray', offset: 0 }]);
      expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('predefined constant resolution', () => {
    it('should resolve dbmNormal as 0x00', async () => {
      const source = `uint8_t data = dbmNormal`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.bytes).toEqual(new Uint8Array([0x00]));
    });

    it('should resolve dbmMasked_last as 0x90', async () => {
      const source = `uint8_t data = dbmMasked_last`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.bytes).toEqual(new Uint8Array([0x90]));
    });

    it('should resolve dbmNormal_end as 0x40', async () => {
      const source = `uint8_t data = dbmNormal_end`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.bytes).toEqual(new Uint8Array([0x40]));
    });
  });

  describe('user symbol references', () => {
    it('should resolve forward-defined symbols', async () => {
      const source = `uint8_t myData = 0xFF
uint24_t ref = myData`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      // myData at offset 0. ref should encode 0x000000 as 3 bytes.
      expect(result.bytes.length).toBe(4); // 1 (uint8) + 3 (uint24)
      expect(result.bytes[1]).toBe(0x00);
      expect(result.bytes[2]).toBe(0x00);
      expect(result.bytes[3]).toBe(0x00);
    });
  });

  describe('include directive', () => {
    it('should include text from another file', async () => {
      const callbacks = makeCallbacks({
        'extra.txt': 'uint8_t extraData = 0xAA',
      });
      const source = `uint8_t first = 0x01
include "extra.txt"`;
      const result = await parseFxData(source, 'test.txt', callbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.bytes).toEqual(new Uint8Array([0x01, 0xAA]));
      expect(result.symbols.length).toBe(2);
    });

    it('should report error for missing include', async () => {
      const source = `include "nonexistent.txt"`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].message).toContain('not found');
    });
  });

  describe('namespace', () => {
    it('should generate namespace header lines', async () => {
      const source = `namespace MyNS
uint8_t data = 0x01
namespace_end`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      const nsOpen = result.headerLines.find((l) => l.includes('namespace MyNS'));
      const nsClose = result.headerLines.find((l) => l.trim() === '}');
      expect(nsOpen).toBeDefined();
      expect(nsClose).toBeDefined();
    });
  });

  describe('savesection', () => {
    it('should mark save section start offset', async () => {
      const source = `uint8_t data = 0x01 0x02
savesection
uint16_t saveData = 0xFFFF`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      expect(result.saveStart).toBe(2); // after 2 bytes of data
      expect(result.bytes.length).toBe(4); // 2 data + 2 save
    });
  });

  describe('drawFrame format', () => {
    it('should parse mixed inline types (drawframes pattern)', async () => {
      // Pattern from ArduboyLogo_Frame.txt:
      // int16_t 20, -15, int24_t ArduboyLogo, int8_t 0, dbmNormal_end
      const source = `uint8_t ArduboyLogo = 0xFF
    ArduboyLogo_Frame[] = {
        int16_t   20, -15, int24_t ArduboyLogo, int8_t 0, dbmNormal_end
        int16_t   20, -14, int24_t ArduboyLogo, int8_t 0, dbmNormal_last
    }`;
      const result = await parseFxData(source, 'test.txt', nullCallbacks);
      // ArduboyLogo at offset 0 (1 byte = 0xFF)
      // ArduboyLogo_Frame at offset 1
      expect(result.symbols.length).toBe(2);
      expect(result.symbols[0].name).toBe('ArduboyLogo');
      expect(result.symbols[0].offset).toBe(0);
      expect(result.symbols[1].name).toBe('ArduboyLogo_Frame');
      expect(result.symbols[1].offset).toBe(1);

      // Each frame entry: int16(2) + int16(2) + int24(3) + int8(1) + int8(1) = 9 bytes
      // Two entries = 18 bytes
      // Total = 1 (ArduboyLogo) + 18 = 19
      expect(result.bytes.length).toBe(19);

      // Verify first frame: 20, -15 as int16 BE
      expect(result.bytes[1]).toBe(0x00); // 20 >> 8
      expect(result.bytes[2]).toBe(20);   // 20 & 0xFF
      // -15 as int16 BE: 0xFFF1
      expect(result.bytes[3]).toBe(0xFF);
      expect(result.bytes[4]).toBe(0xF1);
      // ArduboyLogo reference (offset 0) as uint24: 0x000000
      expect(result.bytes[5]).toBe(0x00);
      expect(result.bytes[6]).toBe(0x00);
      expect(result.bytes[7]).toBe(0x00);
      // int8_t 0
      expect(result.bytes[8]).toBe(0x00);
      // dbmNormal_end = 0x40
      expect(result.bytes[9]).toBe(0x40);
    });
  });

  describe('loadGameState reference', () => {
    it('should match reference: save section only', async () => {
      const source = `
    savesection     //4K block save section. Any data below will be stored in save data area

    uint16_t  0xFFFF //game state end marker / start of unused space`;

      const result = await parseFxData(source, 'fxdata.txt', nullCallbacks);
      expect(result.diagnostics).toEqual([]);
      expect(result.saveStart).toBe(0); // save starts at byte 0 (no data section)
      expect(result.bytes.length).toBe(2); // uint16_t 0xFFFF = 2 bytes
      expect(result.bytes[0]).toBe(0xFF);
      expect(result.bytes[1]).toBe(0xFF);
    });
  });
});
