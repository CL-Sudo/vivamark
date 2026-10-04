// What an attached file really is, read from its bytes, never from its name
// or a declared type. Only PNG, JPEG, GIF and WebP are accepted, and only when
// their header also yields the image's size: a file that merely starts with
// the right magic bytes is not enough.

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

export const IMAGE_EXT: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Larger than any real image; a header claiming more is not trusted. */
const MAX_SIDE = 100_000;

function sized(mime: ImageMime, width: number, height: number): ImageInfo | null {
  if (!(width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE)) return null;
  return { mime, width, height };
}

function png(b: Buffer): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
  // The first chunk must be IHDR, which holds the size.
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return sized('image/png', b.readUInt32BE(16), b.readUInt32BE(20));
}

function gif(b: Buffer): ImageInfo | null {
  if (b.length < 10) return null;
  const head = b.toString('latin1', 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return null;
  return sized('image/gif', b.readUInt16LE(6), b.readUInt16LE(8));
}

/** Walks JPEG segments to the first start-of-frame marker, which holds the size. */
function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // Fill byte.
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // End of image or scan data before any frame.
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null;
      return sized('image/jpeg', b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    i += 2 + len;
  }
  return null;
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // A key frame: start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized('image/webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return sized('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    return sized('image/webp', b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  }
  return null;
}

/** The image's real type and size, or null when the bytes are not a PNG, JPEG, GIF or WebP image. */
export function sniffImage(b: Buffer): ImageInfo | null {
  return png(b) ?? jpeg(b) ?? gif(b) ?? webp(b);
}
