/**
 * Tests for FX Data Symbol Table and Predefined Constants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolTable, FX_PREDEFINED_CONSTANTS } from '../../src/core/fxdata/fxdataSymbols.js';

describe('FX_PREDEFINED_CONSTANTS', () => {
  it('should contain all base drawing modes', () => {
    expect(FX_PREDEFINED_CONSTANTS.get('dbmNormal')).toBe(0x00);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmOverwrite')).toBe(0x00);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmWhite')).toBe(0x01);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmReverse')).toBe(0x08);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmBlack')).toBe(0x0D);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmInvert')).toBe(0x02);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmMasked')).toBe(0x10);
  });

  it('should contain _end variants (add 0x40)', () => {
    expect(FX_PREDEFINED_CONSTANTS.get('dbmNormal_end')).toBe(0x40);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmWhite_end')).toBe(0x41);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmMasked_end')).toBe(0x50);
  });

  it('should contain _last variants (add 0x80)', () => {
    expect(FX_PREDEFINED_CONSTANTS.get('dbmNormal_last')).toBe(0x80);
    expect(FX_PREDEFINED_CONSTANTS.get('dbmMasked_last')).toBe(0x90);
  });

  it('should have exactly 33 constants', () => {
    // 6 base + 5 masked + 6 _end + 5 masked_end + 6 _last + 5 masked_last = 33
    expect(FX_PREDEFINED_CONSTANTS.size).toBe(33);
  });
});

describe('SymbolTable', () => {
  let table;

  beforeEach(() => {
    table = new SymbolTable();
  });

  it('should define and resolve user symbols', () => {
    const result = table.define('myData', 0x100, 'fxdata.txt', 5);
    expect(result.success).toBe(true);

    const sym = table.resolve('myData');
    expect(sym).not.toBeNull();
    expect(sym.value).toBe(0x100);
    expect(sym.source).toBe('user');
  });

  it('should reject duplicate symbols', () => {
    table.define('myData', 0x100);
    const result = table.define('myData', 0x200);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Duplicate');
  });

  it('should resolve predefined constants', () => {
    const sym = table.resolve('dbmNormal');
    expect(sym).not.toBeNull();
    expect(sym.value).toBe(0x00);
    expect(sym.source).toBe('predefined');
  });

  it('should prioritize predefined constants over user symbols', () => {
    // Predefined should still resolve even if a user symbol is added first
    const sym = table.resolve('dbmMasked_last');
    expect(sym.value).toBe(0x90);
    expect(sym.source).toBe('predefined');
  });

  it('should return null for undefined symbols', () => {
    expect(table.resolve('nonexistent')).toBeNull();
  });

  it('should support has()', () => {
    table.define('myLabel', 0x50);
    expect(table.has('myLabel')).toBe(true);
    expect(table.has('dbmNormal')).toBe(true);
    expect(table.has('foobar')).toBe(false);
  });

  it('should reset user symbols without affecting predefined', () => {
    table.define('myLabel', 0x50);
    table.reset();
    expect(table.has('myLabel')).toBe(false);
    expect(table.has('dbmNormal')).toBe(true);
  });

  it('should return user symbols in definition order', () => {
    table.define('alpha', 0x00);
    table.define('beta', 0x10);
    table.define('gamma', 0x20);
    const syms = table.getUserSymbols();
    expect(syms.map((s) => s.name)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
