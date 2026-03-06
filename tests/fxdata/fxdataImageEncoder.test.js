/**
 * Tests for the FX Image Encoder.
 *
 * Tests filename dimension parsing and image encoding with synthetic ImageData.
 */

import { describe, it, expect } from 'vitest';
import { parseDimensionsFromFilename, encodeFxImage } from '../../src/core/fxdata/fxdataImageEncoder.js';

describe('parseDimensionsFromFilename', () => {
  it('should parse WxH from filename', () => {
    const result = parseDimensionsFromFilename('sprite_16x16.png');
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.spacing).toBe(0);
  });

  it('should parse WxH with spacing', () => {
    const result = parseDimensionsFromFilename('tileset_8x8_1.png');
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.spacing).toBe(1);
  });

  it('should parse from right to left', () => {
    const result = parseDimensionsFromFilename('my_cool_sprite_32x24.png');
    expect(result.width).toBe(32);
    expect(result.height).toBe(24);
  });

  it('should return 0 for no dimensions', () => {
    const result = parseDimensionsFromFilename('FXlogo.png');
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('should handle font naming convention', () => {
    const result = parseDimensionsFromFilename('arduboyFont_6x8.png');
    expect(result.width).toBe(6);
    expect(result.height).toBe(8);
  });

  it('should handle masked font naming', () => {
    const result = parseDimensionsFromFilename('maskedFont_16x24.png');
    expect(result.width).toBe(16);
    expect(result.height).toBe(24);
  });
});

describe('encodeFxImage', () => {
  /**
   * Create a synthetic ImageData-like object.
   * Each pixel has RGBA values.
   */
  function makeImageData(width, height, pixels) {
    const data = new Uint8Array(width * height * 4);
    if (pixels) {
      data.set(pixels);
    }
    return { width, height, data };
  }

  it('should produce 4-byte header with width and height (big-endian)', () => {
    // 8x8 white image (all pixels white, fully opaque)
    const imageData = makeImageData(8, 8, new Uint8Array(8 * 8 * 4).fill(255));
    const result = encodeFxImage(imageData, 'test.png');

    // Header: width=8 BE16, height=8 BE16
    expect(result.bytes[0]).toBe(0x00); // width high
    expect(result.bytes[1]).toBe(0x08); // width low
    expect(result.bytes[2]).toBe(0x00); // height high
    expect(result.bytes[3]).toBe(0x08); // height low
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.frames).toBe(1);
  });

  it('should encode a fully white opaque 8x8 image', () => {
    // All white, fully opaque
    const pixels = new Uint8Array(8 * 8 * 4).fill(255);
    const imageData = makeImageData(8, 8, pixels);
    const result = encodeFxImage(imageData, 'test.png');

    expect(result.hasTransparency).toBe(false);
    // 8x8 image: 8 columns × 1 row of 8-pixel bytes = 8 data bytes
    expect(result.bytes.length).toBe(4 + 8); // header + data
    // Each byte should be 0xFF (all 8 pixels white)
    for (let i = 4; i < 12; i++) {
      expect(result.bytes[i]).toBe(0xFF);
    }
  });

  it('should encode a fully black opaque 8x8 image', () => {
    // All black, fully opaque (R=0, G=0, B=0, A=255)
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i++) {
      pixels[i * 4 + 0] = 0;   // R
      pixels[i * 4 + 1] = 0;   // G
      pixels[i * 4 + 2] = 0;   // B
      pixels[i * 4 + 3] = 255; // A
    }
    const imageData = makeImageData(8, 8, pixels);
    const result = encodeFxImage(imageData, 'test.png');

    expect(result.hasTransparency).toBe(false);
    // Each byte should be 0x00 (all pixels black)
    for (let i = 4; i < 12; i++) {
      expect(result.bytes[i]).toBe(0x00);
    }
  });

  it('should detect transparency and interleave mask bytes', () => {
    // 8x8 image with first pixel transparent
    const pixels = new Uint8Array(8 * 8 * 4).fill(255);
    pixels[3] = 0; // First pixel alpha = 0 (transparent)

    const imageData = makeImageData(8, 8, pixels);
    const result = encodeFxImage(imageData, 'test.png');

    expect(result.hasTransparency).toBe(true);
    // With transparency: data bytes are interleaved (image byte, mask byte)
    // 8 columns × 2 bytes each = 16 data bytes
    expect(result.bytes.length).toBe(4 + 16);
  });

  it('should clear white bit for transparent pixels', () => {
    // 8x1 image: first pixel white+transparent, rest white+opaque
    const pixels = new Uint8Array(8 * 1 * 4).fill(255);
    pixels[3] = 0; // First pixel transparent

    const imageData = makeImageData(8, 1, pixels);
    const result = encodeFxImage(imageData, 'test.png');

    expect(result.hasTransparency).toBe(true);
    // First column: bit 0 (LSB) is the first pixel
    // Transparent pixel should have its image bit cleared (b &= 0x7F)
    // The image byte for column 0: bit 0 cleared (transparent), rest are 0 (out of sprite height range)
    const imageByte = result.bytes[4];
    // First pixel is white but transparent → bit should be cleared
    expect(imageByte & 0x01).toBe(0x00);
  });

  it('should handle sprite sheet with dimensions from filename', () => {
    // 16x8 image with 8x8 sprites = 2 frames
    const pixels = new Uint8Array(16 * 8 * 4).fill(255);
    const imageData = makeImageData(16, 8, pixels);
    const result = encodeFxImage(imageData, 'sprites_8x8.png');

    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.frames).toBe(2);
  });

  it('should handle tall images with multiple vertical frames', () => {
    // 8x16 image with 8x8 sprites = 2 vertical frames
    const pixels = new Uint8Array(8 * 16 * 4).fill(255);
    const imageData = makeImageData(8, 16, pixels);
    const result = encodeFxImage(imageData, 'sprites_8x8.png');

    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.frames).toBe(2);
  });
});
