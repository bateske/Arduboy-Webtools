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
