/**
 * Arduboy screen/sprite image format conversion.
 *
 * Handles conversion between standard image formats (via Canvas API)
 * and Arduboy's 1-bit vertical-byte-column display format.
 *
 * Ported from:
 *   - arduboy_toolset/arduboy/image.py
 *   - Arduboy-Python-Utilities/image-converter.py
 */

import { SCREEN_WIDTH, SCREEN_HEIGHT, SCREEN_BYTES } from '../constants.js';

/** Supported output format identifiers. */
export const OUTPUT_FORMAT = {
  DRAW_BITMAP:       'drawBitmap',
  DRAW_SLOW_XY:      'drawSlowXYBitmap',
  SPRITES_OVERWRITE: 'spritesOverwrite',
  SPRITES_EXT_MASK:  'spritesExternalMask',
  SPRITES_PLUS_MASK: 'spritesPlusMask',
};

/**
 * @typedef {Object} TileConfig
 * @property {number} width - Tile width in pixels (0 = full image width)
 * @property {number} height - Tile height in pixels (0 = full image height)
 * @property {number} spacing - Spacing between tiles in pixels
 * @property {boolean} useMask - Generate transparency mask from alpha channel
 * @property {boolean} separateHeaderMask - Mask in separate variable (code output only)
 * @property {boolean} addDimensions - Include width/height in output array
 */

/**
 * @typedef {Object} ConvertedImage
 * @property {string} code - C++ header code string
 * @property {Uint8Array} binary - FX binary data (with 4-byte header)
 * @property {number} frameCount - Number of frames/tiles
 * @property {number} frameWidth - Width per frame
 * @property {number} frameHeight - Height per frame
 */

/**
 * @typedef {Object} ImageConvertConfig
 * @property {string} format - One of OUTPUT_FORMAT values
 * @property {number} width - Frame width (0 = full image width)
 * @property {number} height - Frame height (0 = full image height)
 * @property {number} spacing - Spacing between frames in pixels
 * @property {number} threshold - Brightness threshold (0-255, default 128)
 */

/**
 * Convert a 1024-byte Arduboy screen buffer to an ImageData object.
 *
 * The Arduboy uses a vertical-byte-column format:
 * - 8 rows of 128 columns
 * - Each byte encodes 8 vertical pixels
 * - LSB is the top pixel of the group
 *
 * @param {Uint8Array} bytes - 1024-byte screen buffer
 * @returns {ImageData} 128×64 RGBA image
 */
export function screenToImageData(bytes) {
  const imageData = new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  const pixels = imageData.data;

  for (let strip = 0; strip < 8; strip++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const byte = bytes[strip * SCREEN_WIDTH + x];
      for (let bit = 0; bit < 8; bit++) {
        const y = strip * 8 + bit;
        const pixelIndex = (y * SCREEN_WIDTH + x) * 4;
        const isSet = (byte >> bit) & 1;
        const color = isSet ? 255 : 0;
        pixels[pixelIndex] = color;     // R
        pixels[pixelIndex + 1] = color; // G
        pixels[pixelIndex + 2] = color; // B
        pixels[pixelIndex + 3] = 255;   // A (fully opaque)
      }
    }
  }

  return imageData;
}

/**
 * Convert an ImageData (128×64) to a 1024-byte Arduboy screen buffer.
 *
 * Pixels with brightness > 128 are treated as white (1), others as black (0).
 * The image is resized to 128×64 if necessary.
 *
 * @param {ImageData} imageData - Input image (should be 128×64)
 * @returns {Uint8Array} 1024-byte screen buffer
 */
export function imageDataToScreen(imageData) {
  const result = new Uint8Array(SCREEN_BYTES);
  const pixels = imageData.data;
  const w = imageData.width;

  for (let strip = 0; strip < 8; strip++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const y = strip * 8 + bit;
        const srcX = Math.min(x, w - 1);
        const srcY = Math.min(y, imageData.height - 1);
        const pixelIndex = (srcY * w + srcX) * 4;

        // Use green channel as brightness (same as Python: pixels[...][1] > 64)
        const brightness = pixels[pixelIndex + 1];
        if (brightness > 128) {
          byte |= 1 << bit;
        }
      }
      result[strip * SCREEN_WIDTH + x] = byte;
    }
  }

  return result;
}

/**
 * Convert a screen buffer (1024 bytes) to a data URL for display in an <img> tag.
 * @param {Uint8Array} bytes - 1024-byte screen buffer
 * @param {number} [scale=1] - Scale factor
 * @returns {string} Data URL (image/png)
 */
export function screenToDataURL(bytes, scale = 1) {
  const imageData = screenToImageData(bytes);
  const canvas = new OffscreenCanvas(SCREEN_WIDTH * scale, SCREEN_HEIGHT * scale);
  const ctx = canvas.getContext('2d');

  // Draw at native size then scale
  const tempCanvas = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, SCREEN_WIDTH * scale, SCREEN_HEIGHT * scale);

  // Convert to blob URL
  return canvas.convertToBlob({ type: 'image/png' }).then((blob) => URL.createObjectURL(blob));
}

/**
 * Load an image file and convert to ImageData.
 * Handles resize to 128×64 if needed.
 *
 * @param {File|Blob} file - Image file
 * @returns {Promise<ImageData>} 128×64 ImageData
 */
export async function loadImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Draw scaled to fill 128×64
  ctx.drawImage(bitmap, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  return ctx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
}

/**
 * Convert a sprite/tile image to Arduboy binary format.
 *
 * Supports sprite sheets with multiple tiles arranged in a grid.
 * Generates both C++ code and FX binary data.
 *
 * @param {ImageData} imageData - Source image
 * @param {string} name - Variable name for code output
 * @param {TileConfig} config - Tile configuration
 * @returns {ConvertedImage}
 */
export function convertImage(imageData, name, config) {
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const pixels = imageData.data;

  // Determine frame dimensions
  const fw = config.width || imgWidth;
  const fh = config.height || imgHeight;
  const spacing = config.spacing || 0;

  // Calculate frame count
  const cols = Math.floor((imgWidth + spacing) / (fw + spacing));
  const rows = Math.floor((imgHeight + spacing) / (fh + spacing));
  const frameCount = cols * rows;

  // Height must be multiple of 8 for vertical byte encoding
  const paddedHeight = Math.ceil(fh / 8) * 8;

  const imageBytes = [];
  const maskBytes = [];

  // Process each frame
  for (let frame = 0; frame < frameCount; frame++) {
    const frameCol = frame % cols;
    const frameRow = Math.floor(frame / cols);
    const startX = frameCol * (fw + spacing);
    const startY = frameRow * (fh + spacing);

    // Encode in vertical-byte-column format
    for (let yStrip = 0; yStrip < paddedHeight; yStrip += 8) {
      for (let x = 0; x < fw; x++) {
        let imgByte = 0;
        let maskByte = 0;

        for (let bit = 0; bit < 8; bit++) {
          const srcX = startX + x;
          const srcY = startY + yStrip + bit;

          if (srcX < imgWidth && srcY < imgHeight) {
            const pixelIndex = (srcY * imgWidth + srcX) * 4;
            const brightness = pixels[pixelIndex + 1]; // green channel
            const alpha = pixels[pixelIndex + 3];

            if (brightness > 128) {
              imgByte |= 1 << bit;
            }
            if (alpha > 128) {
              maskByte |= 1 << bit;
            }
          }
        }

        imageBytes.push(imgByte);
        if (config.useMask) {
          maskBytes.push(maskByte);
        }
      }
    }
  }

  // Build FX binary (4-byte header + data)
  const fxHeader = new Uint8Array(4);
  fxHeader[0] = (fw >> 8) & 0xff;
  fxHeader[1] = fw & 0xff;
  fxHeader[2] = (fh >> 8) & 0xff;
  fxHeader[3] = fh & 0xff;

  let binaryData;
  if (config.useMask) {
    // Interleave image and mask bytes for FX
    const interleaved = new Uint8Array(imageBytes.length * 2);
    for (let i = 0; i < imageBytes.length; i++) {
      interleaved[i * 2] = imageBytes[i];
      interleaved[i * 2 + 1] = maskBytes[i];
    }
    binaryData = new Uint8Array(4 + interleaved.length);
    binaryData.set(fxHeader, 0);
    binaryData.set(interleaved, 4);
  } else {
    binaryData = new Uint8Array(4 + imageBytes.length);
    binaryData.set(fxHeader, 0);
    binaryData.set(new Uint8Array(imageBytes), 4);
  }

  // Build C++ code
  const code = generateSpriteCode(name, fw, fh, frameCount, imageBytes, maskBytes, config);

  return {
    code,
    binary: binaryData,
    frameCount,
    frameWidth: fw,
    frameHeight: fh,
  };
}

/**
 * Generate C++ header code for sprite data.
 * @param {string} name - Variable name
 * @param {number} width - Frame width
 * @param {number} height - Frame height
 * @param {number} frameCount - Number of frames
 * @param {number[]} imageBytes - Image data bytes
 * @param {number[]} maskBytes - Mask data bytes (empty if no mask)
 * @param {TileConfig} config
 * @returns {string} C++ header code
 */
function generateSpriteCode(name, width, height, frameCount, imageBytes, maskBytes, config) {
  const lines = [];
  lines.push('#pragma once\n');
  lines.push(`constexpr uint8_t ${name}Width = ${width};`);
  lines.push(`constexpr uint8_t ${name}Height = ${height};\n`);

  const hasMask = config.useMask && maskBytes.length > 0;
  const bytesPerFrame = imageBytes.length / frameCount;

  if (hasMask && !config.separateHeaderMask) {
    // Interleaved image+mask
    lines.push(`const uint8_t PROGMEM ${name}[] = {`);
    lines.push(`  ${width}, ${height},`);
    for (let f = 0; f < frameCount; f++) {
      lines.push(`  // Frame ${f}`);
      const frameStart = f * bytesPerFrame;
      const rowBytes = [];
      for (let i = 0; i < bytesPerFrame; i++) {
        rowBytes.push(`0x${imageBytes[frameStart + i].toString(16).padStart(2, '0')}`);
        rowBytes.push(`0x${maskBytes[frameStart + i].toString(16).padStart(2, '0')}`);
      }
      // Format 12 values per line
      for (let i = 0; i < rowBytes.length; i += 12) {
        lines.push('  ' + rowBytes.slice(i, i + 12).join(', ') + ',');
      }
    }
    lines.push('};');
  } else {
    // Image only (or separate mask)
    lines.push(`const uint8_t PROGMEM ${name}[] = {`);
    if (config.addDimensions) {
      lines.push(`  ${width}, ${height},`);
    }
    for (let f = 0; f < frameCount; f++) {
      if (frameCount > 1) lines.push(`  // Frame ${f}`);
      const frameStart = f * bytesPerFrame;
      const rowBytes = [];
      for (let i = 0; i < bytesPerFrame; i++) {
        rowBytes.push(`0x${imageBytes[frameStart + i].toString(16).padStart(2, '0')}`);
      }
      for (let i = 0; i < rowBytes.length; i += 12) {
        lines.push('  ' + rowBytes.slice(i, i + 12).join(', ') + ',');
      }
    }
    lines.push('};');

    if (hasMask && config.separateHeaderMask) {
      lines.push('');
      lines.push(`const uint8_t PROGMEM ${name}Mask[] = {`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const frameStart = f * bytesPerFrame;
        const rowBytes = [];
        for (let i = 0; i < bytesPerFrame; i++) {
          rowBytes.push(`0x${maskBytes[frameStart + i].toString(16).padStart(2, '0')}`);
        }
        for (let i = 0; i < rowBytes.length; i += 12) {
          lines.push('  ' + rowBytes.slice(i, i + 12).join(', ') + ',');
        }
      }
      lines.push('};');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// New image loader — preserves original dimensions (for sprite sheets)
// ---------------------------------------------------------------------------

/**
 * Load an image file preserving its original dimensions.
 * Unlike loadImageFile(), this does NOT resize to 128×64.
 *
 * @param {File|Blob} file - Image file
 * @returns {Promise<ImageData>} ImageData at original size
 */
export async function loadImageFileOriginal(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

// ---------------------------------------------------------------------------
// Internal byte-packing helpers
// ---------------------------------------------------------------------------

/**
 * Pack a single frame region in vertical-byte-column format.
 * Bit 0 = top pixel of 8-pixel strip, bit 7 = bottom.
 *
 * @returns {{ imageBytes: number[], maskBytes: number[] }}
 */
function packVertical(pixels, startX, startY, fw, paddedHeight, imgWidth, imgHeight, threshold) {
  const imageBytes = [];
  const maskBytes = [];

  for (let yStrip = 0; yStrip < paddedHeight; yStrip += 8) {
    for (let x = 0; x < fw; x++) {
      let imgByte = 0;
      let maskByte = 0;

      for (let bit = 0; bit < 8; bit++) {
        const srcX = startX + x;
        const srcY = startY + yStrip + bit;

        if (srcX < imgWidth && srcY < imgHeight) {
          const idx = (srcY * imgWidth + srcX) * 4;
          const brightness = pixels[idx + 1]; // green channel
          const alpha = pixels[idx + 3];

          if (brightness > threshold) {
            imgByte |= 1 << bit;
          }
          if (alpha > 128) {
            maskByte |= 1 << bit;
          }
        }
      }

      imageBytes.push(imgByte);
      maskBytes.push(maskByte);
    }
  }

  return { imageBytes, maskBytes };
}

/**
 * Pack a single frame region in horizontal row-major format.
 * MSB (bit 7) = leftmost pixel, LSB (bit 0) = rightmost.
 * Each byte = 8 horizontal pixels. Rows padded to ceil(width/8) bytes.
 *
 * @returns {number[]}
 */
function packHorizontal(pixels, startX, startY, fw, fh, imgWidth, imgHeight, threshold) {
  const bytes = [];
  const bytesPerRow = Math.ceil(fw / 8);

  for (let y = 0; y < fh; y++) {
    for (let byteCol = 0; byteCol < bytesPerRow; byteCol++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = startX + byteCol * 8 + bit;
        const py = startY + y;
        if (px < imgWidth && py < imgHeight && (byteCol * 8 + bit) < fw) {
          const idx = (py * imgWidth + px) * 4;
          const brightness = pixels[idx + 1];
          if (brightness > threshold) {
            byte |= 1 << (7 - bit); // MSB = leftmost
          }
        }
      }
      bytes.push(byte);
    }
  }

  return bytes;
}

// ---------------------------------------------------------------------------
// Format-specific converter
// ---------------------------------------------------------------------------

/**
 * Convert an image to Arduboy format with format selection.
 *
 * @param {ImageData} imageData - Source image (any dimensions)
 * @param {string} name - C++ variable name
 * @param {ImageConvertConfig} config
 * @returns {{ code: string, frameCount: number, frameWidth: number, frameHeight: number, paddedHeight: number, byteCount: number }}
 */
export function convertImageFormat(imageData, name, config) {
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const pixels = imageData.data;
  const format = config.format || OUTPUT_FORMAT.SPRITES_OVERWRITE;
  const threshold = config.threshold ?? 128;

  const fw = config.width || imgWidth;
  const fh = config.height || imgHeight;
  const spacing = config.spacing || 0;

  const cols = Math.max(1, Math.floor((imgWidth + spacing) / (fw + spacing)));
  const rows = Math.max(1, Math.floor((imgHeight + spacing) / (fh + spacing)));
  const maxFrames = config.maxFrames || Infinity;
  const frameCount = Math.min(cols * rows, maxFrames);

  const paddedHeight = Math.ceil(fh / 8) * 8;
  const isHorizontal = format === OUTPUT_FORMAT.DRAW_SLOW_XY;

  const allImageBytes = [];
  const allMaskBytes = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const frameCol = frame % cols;
    const frameRow = Math.floor(frame / cols);
    const startX = frameCol * (fw + spacing);
    const startY = frameRow * (fh + spacing);

    if (isHorizontal) {
      const bytes = packHorizontal(pixels, startX, startY, fw, fh, imgWidth, imgHeight, threshold);
      allImageBytes.push(...bytes);
    } else {
      const { imageBytes, maskBytes } = packVertical(
        pixels, startX, startY, fw, paddedHeight, imgWidth, imgHeight, threshold,
      );
      allImageBytes.push(...imageBytes);
      allMaskBytes.push(...maskBytes);
    }
  }

  const code = generateFormatCode(name, format, fw, fh, paddedHeight, frameCount, allImageBytes, allMaskBytes);

  return {
    code,
    frameCount,
    frameWidth: fw,
    frameHeight: fh,
    paddedHeight,
    byteCount: allImageBytes.length + (
      format === OUTPUT_FORMAT.SPRITES_EXT_MASK ? allMaskBytes.length :
      format === OUTPUT_FORMAT.SPRITES_PLUS_MASK ? allImageBytes.length : 0
    ),
  };
}

// ---------------------------------------------------------------------------
// Format-specific C++ code generation
// ---------------------------------------------------------------------------

/** Format a byte array as hex strings, 12 values per line. */
function formatHexLines(bytes, indent = '  ') {
  const lines = [];
  const hex = bytes.map((b) => `0x${b.toString(16).padStart(2, '0')}`);
  for (let i = 0; i < hex.length; i += 12) {
    lines.push(indent + hex.slice(i, i + 12).join(', ') + ',');
  }
  return lines;
}

/**
 * Generate C++ PROGMEM code for a specific output format.
 */
function generateFormatCode(name, format, fw, fh, paddedHeight, frameCount, imageBytes, maskBytes) {
  const lines = [];
  lines.push('#pragma once');
  lines.push('#include <stdint.h>');
  lines.push('#include <avr/pgmspace.h>\n');

  const bytesPerFrame = imageBytes.length / frameCount;

  switch (format) {
    // -- drawBitmap: no header, vertical format --
    case OUTPUT_FORMAT.DRAW_BITMAP: {
      lines.push(`// ${fw}x${paddedHeight}, ${frameCount} frame(s), ${imageBytes.length} bytes`);
      lines.push(`// Render with: Arduboy2Base::drawBitmap(x, y, ${name}, ${fw}, ${paddedHeight}, WHITE);`);
      lines.push(`const uint8_t PROGMEM ${name}[] = {`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * bytesPerFrame;
        lines.push(...formatHexLines(imageBytes.slice(start, start + bytesPerFrame)));
      }
      lines.push('};');
      break;
    }

    // -- drawSlowXYBitmap: no header, horizontal format --
    case OUTPUT_FORMAT.DRAW_SLOW_XY: {
      lines.push(`// ${fw}x${fh}, ${frameCount} frame(s), ${imageBytes.length} bytes`);
      lines.push(`// Render with: Arduboy2Base::drawSlowXYBitmap(x, y, ${name}, ${fw}, ${fh}, WHITE);`);
      lines.push(`const uint8_t PROGMEM ${name}[] = {`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * bytesPerFrame;
        lines.push(...formatHexLines(imageBytes.slice(start, start + bytesPerFrame)));
      }
      lines.push('};');
      break;
    }

    // -- Sprites overwrite: [w, h] header, vertical format --
    case OUTPUT_FORMAT.SPRITES_OVERWRITE: {
      lines.push(`// ${fw}x${paddedHeight}, ${frameCount} frame(s), ${imageBytes.length + 2} bytes`);
      lines.push(`// Render with: Sprites::drawOverwrite(x, y, ${name}, frame);`);
      lines.push(`const uint8_t PROGMEM ${name}[] = {`);
      lines.push(`  ${fw}, ${paddedHeight},`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * bytesPerFrame;
        lines.push(...formatHexLines(imageBytes.slice(start, start + bytesPerFrame)));
      }
      lines.push('};');
      break;
    }

    // -- Sprites external mask: image array [w,h]+data, mask array data only --
    case OUTPUT_FORMAT.SPRITES_EXT_MASK: {
      const maskBytesPerFrame = maskBytes.length / frameCount;
      lines.push(`// ${fw}x${paddedHeight}, ${frameCount} frame(s)`);
      lines.push(`// Image: ${imageBytes.length + 2} bytes, Mask: ${maskBytes.length} bytes`);
      lines.push(`// Render with: Sprites::drawExternalMask(x, y, ${name}, ${name}Mask, frame, 0);`);
      lines.push(`const uint8_t PROGMEM ${name}[] = {`);
      lines.push(`  ${fw}, ${paddedHeight},`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * bytesPerFrame;
        lines.push(...formatHexLines(imageBytes.slice(start, start + bytesPerFrame)));
      }
      lines.push('};\n');
      lines.push(`const uint8_t PROGMEM ${name}Mask[] = {`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * maskBytesPerFrame;
        lines.push(...formatHexLines(maskBytes.slice(start, start + maskBytesPerFrame)));
      }
      lines.push('};');
      break;
    }

    // -- Sprites plus-mask: [w, h] header, interleaved (image, mask) pairs --
    case OUTPUT_FORMAT.SPRITES_PLUS_MASK: {
      lines.push(`// ${fw}x${paddedHeight}, ${frameCount} frame(s), ${imageBytes.length * 2 + 2} bytes`);
      lines.push(`// Render with: Sprites::drawPlusMask(x, y, ${name}, frame);`);
      lines.push(`const uint8_t PROGMEM ${name}[] = {`);
      lines.push(`  ${fw}, ${paddedHeight},`);
      for (let f = 0; f < frameCount; f++) {
        if (frameCount > 1) lines.push(`  // Frame ${f}`);
        const start = f * bytesPerFrame;
        const interleaved = [];
        for (let i = 0; i < bytesPerFrame; i++) {
          interleaved.push(imageBytes[start + i]);
          interleaved.push(maskBytes[start + i]);
        }
        lines.push(...formatHexLines(interleaved));
      }
      lines.push('};');
      break;
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Usage snippet & full sketch generators
// ---------------------------------------------------------------------------

/**
 * Generate the appropriate Arduboy2 draw call snippet for a format.
 *
 * @param {string} name - Variable name
 * @param {string} format - One of OUTPUT_FORMAT values
 * @param {number} fw - Frame width
 * @param {number} fh - Frame height (padded for vertical formats)
 * @param {number} frameCount - Number of frames
 * @returns {string}
 */
export function generateUsageSnippet(name, format, fw, fh, frameCount) {
  switch (format) {
    case OUTPUT_FORMAT.DRAW_BITMAP:
      return `arduboy.drawBitmap(0, 0, ${name}, ${fw}, ${fh}, WHITE);`;
    case OUTPUT_FORMAT.DRAW_SLOW_XY:
      return `arduboy.drawSlowXYBitmap(0, 0, ${name}, ${fw}, ${fh}, WHITE);`;
    case OUTPUT_FORMAT.SPRITES_OVERWRITE:
      return `Sprites::drawOverwrite(0, 0, ${name}, 0);`;
    case OUTPUT_FORMAT.SPRITES_EXT_MASK:
      return `Sprites::drawExternalMask(0, 0, ${name}, ${name}Mask, 0, 0);`;
    case OUTPUT_FORMAT.SPRITES_PLUS_MASK:
      return `Sprites::drawPlusMask(0, 0, ${name}, 0);`;
    default:
      return `// Unknown format: ${format}`;
  }
}

/**
 * Generate a complete, compilable Arduboy sketch that displays the bitmap.
 * For sprite sheets with multiple frames, the loop cycles through each frame
 * with a short delay, animating the sprite.
 *
 * @param {string} name - Variable name
 * @param {string} format - One of OUTPUT_FORMAT values
 * @param {number} fw - Frame width
 * @param {number} fh - Frame height (padded for vertical formats; original for drawSlowXY)
 * @param {string} code - The PROGMEM array code
 * @param {string} usageSnippet - The draw call line (used for single-frame case)
 * @param {number} [frameCount=1] - Number of frames in the sprite sheet
 * @returns {string}
 */
export function generateFullSketch(name, format, fw, fh, code, usageSnippet, frameCount = 1) {
  const needSprites = format === OUTPUT_FORMAT.SPRITES_OVERWRITE
    || format === OUTPUT_FORMAT.SPRITES_EXT_MASK
    || format === OUTPUT_FORMAT.SPRITES_PLUS_MASK;

  const lines = [];
  lines.push('#include <Arduboy2.h>');
  if (needSprites) lines.push('#include <Sprites.h>');
  lines.push('');
  lines.push('Arduboy2 arduboy;');
  lines.push('');

  // Strip the #pragma once and #include lines from the generated code
  // since the full sketch already has its own includes
  const codeLines = code.split('\n').filter((l) =>
    !l.startsWith('#pragma once') && !l.startsWith('#include'),
  );
  lines.push(codeLines.join('\n').trim());
  lines.push('');

  const isMultiFrame = frameCount > 1;

  if (isMultiFrame) {
    // Global state for animation
    lines.push(`uint8_t currentFrame = 0;`);
    lines.push(`uint8_t frameTimer = 0;`);
    lines.push(`const uint8_t FRAME_COUNT = ${frameCount};`);
    lines.push(`const uint8_t FRAME_DELAY = 8;  // game frames between animation steps (~7 fps at 60 fps)`);
    lines.push('');
  }

  lines.push('void setup() {');
  lines.push('  arduboy.begin();');
  lines.push('  arduboy.setFrameRate(60);');
  lines.push('}');
  lines.push('');
  lines.push('void loop() {');
  lines.push('  if (!arduboy.nextFrame()) return;');
  lines.push('  arduboy.clear();');
  lines.push('');

  if (isMultiFrame) {
    // Build the draw call that references currentFrame
    switch (format) {
      case OUTPUT_FORMAT.DRAW_BITMAP: {
        // Bytes per frame for vertical format: fw * (fh / 8)
        const bpf = fw * (fh / 8);
        lines.push(`  const uint16_t BYTES_PER_FRAME = ${bpf};`);
        lines.push(`  arduboy.drawBitmap(0, 0, ${name} + currentFrame * BYTES_PER_FRAME, ${fw}, ${fh}, WHITE);`);
        break;
      }
      case OUTPUT_FORMAT.DRAW_SLOW_XY: {
        // Bytes per frame for horizontal format: ceil(fw/8) * fh
        const bpf = Math.ceil(fw / 8) * fh;
        lines.push(`  const uint16_t BYTES_PER_FRAME = ${bpf};`);
        lines.push(`  arduboy.drawSlowXYBitmap(0, 0, ${name} + currentFrame * BYTES_PER_FRAME, ${fw}, ${fh}, WHITE);`);
        break;
      }
      case OUTPUT_FORMAT.SPRITES_OVERWRITE:
        lines.push(`  Sprites::drawOverwrite(0, 0, ${name}, currentFrame);`);
        break;
      case OUTPUT_FORMAT.SPRITES_EXT_MASK:
        lines.push(`  Sprites::drawExternalMask(0, 0, ${name}, ${name}Mask, currentFrame, 0);`);
        break;
      case OUTPUT_FORMAT.SPRITES_PLUS_MASK:
        lines.push(`  Sprites::drawPlusMask(0, 0, ${name}, currentFrame);`);
        break;
    }
    lines.push('');
    lines.push('  arduboy.display();');
    lines.push('');
    lines.push('  // Advance animation frame');
    lines.push('  if (++frameTimer >= FRAME_DELAY) {');
    lines.push('    frameTimer = 0;');
    lines.push('    if (++currentFrame >= FRAME_COUNT) currentFrame = 0;');
    lines.push('  }');
  } else {
    lines.push(`  ${usageSnippet}`);
    lines.push('');
    lines.push('  arduboy.display();');
  }

  lines.push('}');

  return lines.join('\n');
}
