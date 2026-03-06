/**
 * Tests for the FX Data Project virtual filesystem.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FxDataProject } from '../../src/core/fxdata/fxdataProject.js';

describe('FxDataProject', () => {
  let project;

  beforeEach(() => {
    project = new FxDataProject();
  });

  describe('basic file operations', () => {
    it('should add and retrieve text files', () => {
      project.addFile('test.txt', 'Hello World');
      expect(project.getTextFile('test.txt')).toBe('Hello World');
    });

    it('should add and retrieve binary files', () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      project.addFile('test.bin', data);
      expect(project.getBinaryFile('test.bin')).toEqual(data);
    });

    it('should overwrite existing files', () => {
      project.addFile('test.txt', 'first');
      project.addFile('test.txt', 'second');
      expect(project.getTextFile('test.txt')).toBe('second');
    });

    it('should remove files', () => {
      project.addFile('test.txt', 'data');
      expect(project.removeFile('test.txt')).toBe(true);
      expect(project.hasFile('test.txt')).toBe(false);
    });

    it('should return false when removing nonexistent file', () => {
      expect(project.removeFile('nope.txt')).toBe(false);
    });

    it('should return undefined for nonexistent files', () => {
      expect(project.getTextFile('nope.txt')).toBeUndefined();
      expect(project.getBinaryFile('nope.bin')).toBeUndefined();
    });
  });

  describe('path normalization', () => {
    it('should normalize backslashes to forward slashes', () => {
      project.addFile('folder\\file.txt', 'data');
      expect(project.hasFile('folder/file.txt')).toBe(true);
    });

    it('should strip leading slashes', () => {
      project.addFile('/folder/file.txt', 'data');
      expect(project.hasFile('folder/file.txt')).toBe(true);
    });

    it('should collapse . and .. segments', () => {
      project.addFile('a/b/../c/./d.txt', 'data');
      expect(project.hasFile('a/c/d.txt')).toBe(true);
    });
  });

  describe('listing and filtering', () => {
    it('should list all files sorted', () => {
      project.addFile('b.txt', 'b');
      project.addFile('a.txt', 'a');
      project.addFile('c.png', new Uint8Array([1]));
      expect(project.listFiles()).toEqual(['a.txt', 'b.txt', 'c.png']);
    });

    it('should filter by extension', () => {
      project.addFile('a.txt', 'a');
      project.addFile('b.png', new Uint8Array([1]));
      project.addFile('c.txt', 'c');
      expect(project.listByExtension('.txt')).toEqual(['a.txt', 'c.txt']);
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative paths from a file directory', () => {
      const result = project.resolvePath('../assets/image.png', 'fxdata/fxdata.txt');
      expect(result).toBe('assets/image.png');
    });

    it('should resolve same-directory paths', () => {
      const result = project.resolvePath('extra.txt', 'fxdata.txt');
      expect(result).toBe('extra.txt');
    });

    it('should resolve paths from subdirectory', () => {
      const result = project.resolvePath('image.png', 'fxdata/fxdata.txt');
      expect(result).toBe('fxdata/image.png');
    });
  });

  describe('clear', () => {
    it('should remove all files', () => {
      project.addFile('a.txt', 'a');
      project.addFile('b.txt', 'b');
      project.clear();
      expect(project.size).toBe(0);
      expect(project.listFiles()).toEqual([]);
    });
  });

  describe('size', () => {
    it('should track the number of files', () => {
      expect(project.size).toBe(0);
      project.addFile('a.txt', 'a');
      expect(project.size).toBe(1);
      project.addFile('b.txt', 'b');
      expect(project.size).toBe(2);
    });
  });

  describe('serialization', () => {
    it('should round-trip text files through serialize/deserialize', () => {
      project.addFile('test.txt', 'Hello');
      const serialized = project.serialize();
      const restored = new FxDataProject();
      restored.deserialize(serialized);
      expect(restored.getTextFile('test.txt')).toBe('Hello');
    });

    it('should round-trip binary files through serialize/deserialize', () => {
      const data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
      project.addFile('test.bin', data);
      const serialized = project.serialize();
      const restored = new FxDataProject();
      restored.deserialize(serialized);
      expect(restored.getBinaryFile('test.bin')).toEqual(data);
    });
  });
});
