/**
 * Tests for the FX Data Build Orchestrator.
 *
 * Tests the full build pipeline including header generation, page math,
 * and output structure. Uses the loadGameState reference as a golden fixture
 * (no images needed, so works in Node environment).
 */

import { describe, it, expect } from 'vitest';
import { FxDataProject } from '../../src/core/fxdata/fxdataProject.js';
import { buildFxData } from '../../src/core/fxdata/fxdataBuild.js';

describe('buildFxData', () => {
  describe('empty project', () => {
    it('should handle missing entry file', async () => {
      const project = new FxDataProject();
      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe('error');
    });
  });

  describe('basic data project', () => {
    it('should build simple uint8 data', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', 'uint8_t myData = 0x01 0x02 0x03');

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.success).toBe(true);
      expect(result.dataSize).toBe(3);
      expect(result.saveSize).toBe(0);
      expect(result.dataBin).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
      expect(result.saveBin).toBeNull();
    });

    it('should calculate correct page math', async () => {
      const project = new FxDataProject();
      // 300 bytes of data → ceil(300/256) = 2 pages
      const bytes = Array.from({ length: 300 }, (_, i) => `0x${(i & 0xFF).toString(16).padStart(2, '0')}`).join(' ');
      project.addFile('fxdata.txt', `uint8_t data = ${bytes}`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.success).toBe(true);
      expect(result.dataSize).toBe(300);
      expect(result.dataPages).toBe(2); // ceil(300/256)
      expect(result.fxDataPage).toBe(65536 - 2); // 65534
      expect(result.fxSavePage).toBeNull();
    });
  });

  describe('loadGameState reference', () => {
    it('should match reference header values', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', `
    savesection     //4K block save section. Any data below will be stored in save data area

    uint16_t  0xFFFF //game state end marker / start of unused space`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.success).toBe(true);

      // Reference fxdata.h values:
      // FX_DATA_PAGE  = 0xfff0
      // FX_DATA_BYTES = 0
      // FX_SAVE_PAGE  = 0xfff0
      // FX_SAVE_BYTES = 2

      expect(result.dataSize).toBe(0);
      expect(result.saveSize).toBe(2);

      // Save pages: ceil(2 / 4096) * 16 = 1 * 16 = 16
      expect(result.savePages).toBe(16);

      // FX_DATA_PAGE = 65536 - 0 (dataPages) - 16 (savePages) = 65520 = 0xFFF0
      expect(result.fxDataPage).toBe(0xFFF0);

      // FX_SAVE_PAGE = 65536 - 16 = 65520 = 0xFFF0
      expect(result.fxSavePage).toBe(0xFFF0);

      // Verify header contains the expected values
      expect(result.header).toContain('FX_DATA_PAGE  = 0xfff0');
      expect(result.header).toContain('FX_DATA_BYTES = 0');
      expect(result.header).toContain('FX_SAVE_PAGE  = 0xfff0');
      expect(result.header).toContain('FX_SAVE_BYTES = 2');

      // Save binary should be the 2 bytes: 0xFF, 0xFF
      expect(result.saveBin).toEqual(new Uint8Array([0xFF, 0xFF]));
    });
  });

  describe('header generation', () => {
    it('should include #pragma once and using directive', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', 'uint8_t data = 0x42');

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.header).toContain('#pragma once');
      expect(result.header).toContain('using uint24_t = __uint24;');
      expect(result.header).toContain('FX::begin(FX_DATA_PAGE)');
    });

    it('should include symbol constants in header', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', `uint8_t myFirst = 0x01
uint16_t mySecond = 0x0203`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.header).toContain('constexpr uint24_t myFirst = 0x000000;');
      expect(result.header).toContain('constexpr uint24_t mySecond = 0x000001;');
    });
  });

  describe('dev binary', () => {
    it('should pad data to page boundary', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', 'uint8_t data = 0x42');

      const result = await buildFxData(project, 'fxdata.txt');
      // 1 byte of data, padded to 256 bytes (1 page)
      expect(result.devBin.length).toBe(256);
      expect(result.devBin[0]).toBe(0x42);
      // Rest should be 0xFF padding
      for (let i = 1; i < 256; i++) {
        expect(result.devBin[i]).toBe(0xFF);
      }
    });

    it('should include save section with 4KB alignment in dev binary', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', `uint8_t data = 0x01
savesection
uint16_t saveData = 0xFFFF`);

      const result = await buildFxData(project, 'fxdata.txt');
      // Data: 1 byte → 1 page (256 bytes padded)
      // Save: 2 bytes → ceil(2/4096)*16 pages = 16 pages = 4096 bytes padded
      expect(result.devBin.length).toBe(256 + 4096);
    });
  });

  describe('include resolution', () => {
    it('should resolve includes from project VFS', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', `uint8_t first = 0x01
include "more.txt"`);
      project.addFile('more.txt', 'uint8_t second = 0x02');

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.success).toBe(true);
      expect(result.dataSize).toBe(2);
      expect(result.symbols.length).toBe(2);
      expect(result.symbols[0].name).toBe('first');
      expect(result.symbols[1].name).toBe('second');
    });
  });

  describe('page math edge cases', () => {
    it('should handle exactly 256 bytes (1 page)', async () => {
      const project = new FxDataProject();
      const bytes = Array(256).fill('0x00').join(' ');
      project.addFile('fxdata.txt', `uint8_t data = ${bytes}`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.dataPages).toBe(1);
      expect(result.fxDataPage).toBe(65535);
    });

    it('should handle 257 bytes (2 pages)', async () => {
      const project = new FxDataProject();
      const bytes = Array(257).fill('0x00').join(' ');
      project.addFile('fxdata.txt', `uint8_t data = ${bytes}`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.dataPages).toBe(2);
      expect(result.fxDataPage).toBe(65534);
    });

    it('should handle zero data with save section', async () => {
      const project = new FxDataProject();
      project.addFile('fxdata.txt', `savesection
uint8_t save = 0x01`);

      const result = await buildFxData(project, 'fxdata.txt');
      expect(result.dataSize).toBe(0);
      expect(result.saveSize).toBe(1);
      expect(result.dataPages).toBe(0);
      expect(result.savePages).toBe(16); // ceil(1/4096)*16
    });
  });
});
