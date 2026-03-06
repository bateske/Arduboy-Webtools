/**
 * FX-specific image encoder for fxdata builds.
 *
 * Replicates the imageData() function from fxdata-build.py, producing
 * binary data compatible with the ArduboyFX runtime library.
 *
 * The FX binary format for images:
 *   - 4-byte header: width (BE16), height (BE16)
 *   - Pixel data in vertical-byte-column format
 *   - If image has transparency: interleaved image+mask bytes
 */

/**
 * Parse sprite dimensions and spacing from a filename.
 *
 * Matches the Python pattern: FILENAME_WxH_S.EXT
 *   W = width, H = height, S = spacing (optional)
 *
 * Scans underscore-separated segments from right to left looking for WxH.
 *
 * @param {string} filename - Filename (basename, no directory)
 * @returns {{ width: number, height: number, spacing: number }}
 */
export function parseDimensionsFromFilename(filename) {
  // Strip extension and split on underscores
  const nameOnly = filename.replace(/\.[^.]+$/, '');
  const elements = nameOnly.split('_');
  const lastIndex = elements.length - 1;

  let width = 0;
  let height = 0;
  let spacing = 0;

  // Scan from right to left for WxH pattern
  for (let i = lastIndex; i > 0; i--) {
    const parts = elements[i].split('x').filter((s) => s.length > 0);
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      width = parseInt(parts[0], 10);
      height = parseInt(parts[1], 10);
      // Check if next element (to the right) is spacing
      if (i < lastIndex && /^\d+$/.test(elements[i + 1])) {
        spacing = parseInt(elements[i + 1], 10);
      }
      break;
    }
  }

  return { width, height, spacing };
}

/**
 * Encode an image for FX data binary output.
 *
 * Matches fxdata-build.py imageData() behavior:
 *   - 4-byte header: width (big-endian uint16), height (big-endian uint16)
 *   - Vertical-byte-column pixel encoding
 *   - Transparency → interleaved image byte + mask byte pairs
 *   - Transparent pixels clear the image bit (b &= 0x7F)
 *
 * @param {ImageData} imageData - Source image (from canvas)
 * @param {string} filename - Original filename for dimension parsing
 * @param {Object} [options]
 * @param {number} [options.threshold=128] - Brightness threshold for white pixels
 * @param {number} [options.alphaThreshold=128] - Alpha threshold for opaque pixels
 * @param {number} [options.spriteWidth] - Override width from filename
 * @param {number} [options.spriteHeight] - Override height from filename
 * @param {number} [options.spacing] - Override spacing from filename
 * @returns {{ bytes: Uint8Array, width: number, height: number, frames: number, hasTransparency: boolean }}
 */
export function encodeFxImage(imageData, filename, options = {}) {
  const threshold = options.threshold ?? 128;
  const alphaThreshold = options.alphaThreshold ?? 128;
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const pixels = imageData.data; // RGBA flat array

  // Parse dimensions from filename (can be overridden)
  const parsed = parseDimensionsFromFilename(filename);
  let spriteWidth = options.spriteWidth ?? parsed.width;
  let spriteHeight = options.spriteHeight ?? parsed.height;
  const spacing = options.spacing ?? parsed.spacing;

  // Detect transparency
  let hasTransparency = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      hasTransparency = true;
      break;
    }
  }

  // Calculate frame grid
  let hframes, vframes;
  if (spriteWidth > 0) {
    hframes = Math.floor((imgWidth - spacing) / (spriteWidth + spacing));
  } else {
    spriteWidth = imgWidth - 2 * spacing;
    hframes = 1;
  }
  if (spriteHeight > 0) {
    vframes = Math.floor((imgHeight - spacing) / (spriteHeight + spacing));
  } else {
    spriteHeight = imgHeight - 2 * spacing;
    vframes = 1;
  }

  // Ensure at least 1 frame
  hframes = Math.max(1, hframes);
  vframes = Math.max(1, vframes);

  // Calculate data size
  const paddedHeight = Math.ceil(spriteHeight / 8) * 8;
  const bytesPerFrame = (paddedHeight / 8) * spriteWidth;
  const totalFrames = hframes * vframes;
  let dataSize = bytesPerFrame * totalFrames;
  if (hasTransparency) dataSize *= 2; // interleaved mask

  // Build the binary: 4-byte header + pixel data
  const bytes = new Uint8Array(4 + dataSize);

  // Header: width and height as big-endian uint16
  bytes[0] = (spriteWidth >> 8) & 0xFF;
  bytes[1] = spriteWidth & 0xFF;
  bytes[2] = (spriteHeight >> 8) & 0xFF;
  bytes[3] = spriteHeight & 0xFF;

  // Encode pixel data — matching Python loop exactly
  let idx = 4;
  let fy = spacing;
  let frames = 0;

  for (let v = 0; v < vframes; v++) {
    let fx = spacing;
    for (let h = 0; h < hframes; h++) {
      for (let y = 0; y < spriteHeight; y += 8) {
        for (let x = 0; x < spriteWidth; x++) {
          let b = 0;
          let m = 0;

          for (let p = 0; p < 8; p++) {
            b = b >> 1;
            m = m >> 1;

            if (y + p < spriteHeight) {
              const px = (fy + y + p) * imgWidth + (fx + x);
              const pixelIdx = px * 4;
              // Green channel for brightness (matches Python: pixels[...][1])
              if (pixels[pixelIdx + 1] > threshold) {
                b |= 0x80; // white pixel
              }
              if (pixels[pixelIdx + 3] > alphaThreshold) {
                m |= 0x80; // opaque pixel
              } else {
                b &= 0x7F; // transparent pixel: clear white bit
              }
            }
          }

          bytes[idx++] = b;
          if (hasTransparency) {
            bytes[idx++] = m;
          }
        }
      }
      frames++;
      fx += spriteWidth + spacing;
    }
    fy += spriteHeight + spacing;
  }

  return { bytes, width: spriteWidth, height: spriteHeight, frames, hasTransparency };
}

/**
 * Determine the naming convention for image dimension constants.
 *
 * Matches fxdata-build.py label naming logic:
 *   - ALL_CAPS → NAME_WIDTH / NAME_HEIGHT / NAME_FRAMES
 *   - has_underscore → name_width / name_height / name_frames
 *   - camelCase → nameWidth / nameHeight / nameFrames
 *
 * @param {string} label - The symbol name
 * @returns {{ widthName: string, heightName: string, framesName: string, framesType: string }}
 */
export function getImageConstantNames(label, frames) {
  if (label === label.toUpperCase()) {
    // ALL_CAPS
    return {
      widthName: `${label}_WIDTH`,
      heightName: `${label}HEIGHT`,
      framesName: `${label}_FRAMES`,
      framesType: 'uint8_t',
    };
  } else if (label.includes('_')) {
    // snake_case
    return {
      widthName: `${label}_width`,
      heightName: `${label}_height`,
      framesName: `${label}_frames`,
      framesType: 'uint8_t',
    };
  } else {
    // camelCase
    return {
      widthName: `${label}Width`,
      heightName: `${label}Height`,
      framesName: `${label}Frames`,
      framesType: frames > 255 ? 'uint16_t' : 'uint8_t',
    };
  }
}

/**
 * Load an image file as ImageData in a browser environment.
 * @param {Uint8Array} data - Raw image file bytes
 * @returns {Promise<ImageData>}
 */
export async function loadImageFromBytes(data) {
  const blob = new Blob([data]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}
