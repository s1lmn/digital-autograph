import sharp from 'sharp';
import type { Metadata, OutputInfo } from 'sharp';
import type { AutographSource } from '@digital-autograph/domain';

export const imagePolicy = {
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 20_000_000,
  maxInputDimension: 10_000,
  maxOutputDimension: 2048,
  maxOutputBytes: 10 * 1024 * 1024,
  photoBackgroundTileSize: 64,
  photoWeakContrast: 0.1,
  photoStrongContrast: 0.35,
  maximumPhotoForegroundFraction: 0.65,
  cropAlphaThreshold: 32,
  padding: 16,
  minimumForegroundPixels: 8,
  minimumForegroundFraction: 0.00001,
} as const;

export type ImageFailureCode =
  | 'INVALID_IMAGE'
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_DIMENSIONS_EXCEEDED'
  | 'EMPTY_AUTOGRAPH';

export class ImageProcessingError extends Error {
  constructor(readonly code: ImageFailureCode) {
    super(code);
  }
}

function detectedFormat(
  bytes: Buffer,
): 'jpeg' | 'png' | 'unsupported' | 'invalid' {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'jpeg';
  const prefix = bytes
    .subarray(0, 32)
    .toString('ascii')
    .trimStart()
    .toLowerCase();
  if (
    prefix.startsWith('gif8') ||
    prefix.startsWith('%pdf') ||
    prefix.startsWith('<svg') ||
    prefix.startsWith('<?xml') ||
    prefix.startsWith('ii*') ||
    prefix.startsWith('mm*') ||
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' ||
    bytes.subarray(4, 12).toString('ascii').includes('ftyp')
  )
    return 'unsupported';
  return 'invalid';
}

function decoder(bytes: Buffer) {
  return sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: imagePolicy.maxInputPixels,
    limitInputChannels: 4,
    unlimited: false,
    animated: false,
    pages: 1,
  });
}

function luminance(pixels: Buffer, offset: number): number {
  return (
    0.2126 * (pixels[offset] ?? 0) +
    0.7152 * (pixels[offset + 1] ?? 0) +
    0.0722 * (pixels[offset + 2] ?? 0)
  );
}

// Paper must dominate each coarse region. A high percentile ignores sparse ink;
// local estimates follow lighting instead of treating dim paper as dark ink.
function estimatePaper(pixels: Buffer, width: number, height: number) {
  const columns = Math.max(
    1,
    Math.ceil(width / imagePolicy.photoBackgroundTileSize),
  );
  const rows = Math.max(
    1,
    Math.ceil(height / imagePolicy.photoBackgroundTileSize),
  );
  const tileWidth = width / columns;
  const tileHeight = height / rows;
  const paper = new Float64Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const histogram = new Uint32Array(256);
      let count = 0;
      for (
        let y = Math.floor(row * tileHeight);
        y < Math.floor((row + 1) * tileHeight);
        y++
      ) {
        for (
          let x = Math.floor(column * tileWidth);
          x < Math.floor((column + 1) * tileWidth);
          x++
        ) {
          const offset = (y * width + x) * 4;
          if ((pixels[offset + 3] ?? 0) < imagePolicy.cropAlphaThreshold)
            continue;
          const value = Math.round(luminance(pixels, offset));
          histogram[value] = (histogram[value] ?? 0) + 1;
          count++;
        }
      }
      let cumulative = 0;
      for (let value = 0; value < 256; value++) {
        cumulative += histogram[value] ?? 0;
        if (cumulative >= Math.max(1, Math.ceil(count * 0.75))) {
          paper[row * columns + column] = value;
          break;
        }
      }
    }
  }
  return (x: number, y: number): number => {
    const gx = Math.max(0, Math.min(columns - 1, (x + 0.5) / tileWidth - 0.5));
    const gy = Math.max(0, Math.min(rows - 1, (y + 0.5) / tileHeight - 0.5));
    const left = Math.floor(gx);
    const top = Math.floor(gy);
    const right = Math.min(columns - 1, left + 1);
    const bottom = Math.min(rows - 1, top + 1);
    const dx = gx - left;
    const dy = gy - top;
    const upper =
      (paper[top * columns + left] ?? 0) * (1 - dx) +
      (paper[top * columns + right] ?? 0) * dx;
    const lower =
      (paper[bottom * columns + left] ?? 0) * (1 - dx) +
      (paper[bottom * columns + right] ?? 0) * dx;
    return upper * (1 - dy) + lower * dy;
  };
}

export async function processAutographImage(
  bytes: Buffer,
  source: AutographSource,
  declaredContentType: string,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (bytes.length < 1 || bytes.length > imagePolicy.maxInputBytes)
    throw new ImageProcessingError('IMAGE_TOO_LARGE');
  const signature = detectedFormat(bytes);
  if (signature === 'unsupported')
    throw new ImageProcessingError('UNSUPPORTED_IMAGE_FORMAT');
  if (signature === 'invalid') throw new ImageProcessingError('INVALID_IMAGE');
  let metadata: Metadata;
  try {
    metadata = await decoder(bytes).metadata();
  } catch (error) {
    if (
      error instanceof Error &&
      /pixel limit|limitInputPixels/i.test(error.message)
    )
      throw new ImageProcessingError('IMAGE_DIMENSIONS_EXCEEDED');
    throw new ImageProcessingError('INVALID_IMAGE');
  }
  if (metadata.format !== signature || (metadata.pages ?? 1) !== 1)
    throw new ImageProcessingError('UNSUPPORTED_IMAGE_FORMAT');
  if (
    declaredContentType !== (signature === 'jpeg' ? 'image/jpeg' : 'image/png')
  )
    throw new ImageProcessingError('INVALID_IMAGE');
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > imagePolicy.maxInputDimension ||
    metadata.height > imagePolicy.maxInputDimension ||
    metadata.width * metadata.height > imagePolicy.maxInputPixels
  ) {
    throw new ImageProcessingError('IMAGE_DIMENSIONS_EXCEEDED');
  }

  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await decoder(bytes)
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageProcessingError('INVALID_IMAGE');
  }
  const { width, height, channels } = decoded.info;
  if (
    channels !== 4 ||
    width > imagePolicy.maxInputDimension ||
    height > imagePolicy.maxInputDimension ||
    width * height > imagePolicy.maxInputPixels
  ) {
    throw new ImageProcessingError('IMAGE_DIMENSIONS_EXCEEDED');
  }
  const pixels = Buffer.from(decoded.data);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let foreground = 0;
  const paper =
    source === 'photo' ? estimatePaper(pixels, width, height) : undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const originalAlpha = pixels[offset + 3] ?? 0;
      let alpha = originalAlpha;
      if (source === 'photo') {
        const background = paper?.(x, y) ?? 0;
        const contrast =
          (background - luminance(pixels, offset)) / Math.max(32, background);
        const strength = Math.max(
          0,
          Math.min(
            1,
            (contrast - imagePolicy.photoWeakContrast) /
              (imagePolicy.photoStrongContrast - imagePolicy.photoWeakContrast),
          ),
        );
        // Smoothstep retains antialiased stroke edges without promoting noise.
        alpha = Math.round(
          originalAlpha * strength * strength * (3 - 2 * strength),
        );
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = alpha;
      }
      if (alpha >= imagePolicy.cropAlphaThreshold) {
        foreground++;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (
    foreground <
    Math.max(
      imagePolicy.minimumForegroundPixels,
      Math.ceil(width * height * imagePolicy.minimumForegroundFraction),
    )
  ) {
    throw new ImageProcessingError('EMPTY_AUTOGRAPH');
  }
  // A filled frame is not credible sparse ink on paper. Fail closed instead
  // of presenting a black rectangle for approval; keep the existing error code.
  if (
    source === 'photo' &&
    foreground / (width * height) > imagePolicy.maximumPhotoForegroundFraction
  ) {
    throw new ImageProcessingError('INVALID_IMAGE');
  }
  const cropped = sharp(pixels, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .extend({
      top: imagePolicy.padding,
      bottom: imagePolicy.padding,
      left: imagePolicy.padding,
      right: imagePolicy.padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize({
      width: imagePolicy.maxOutputDimension,
      height: imagePolicy.maxOutputDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 });
  const output = await cropped.toBuffer({ resolveWithObject: true });
  if (output.data.length < 1 || output.data.length > imagePolicy.maxOutputBytes)
    throw new ImageProcessingError('IMAGE_TOO_LARGE');
  return {
    bytes: output.data,
    width: output.info.width,
    height: output.info.height,
  };
}

export function restrictWorkerImageLoaders(): void {
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({
    operation: [
      'VipsForeignLoadJpeg',
      'VipsForeignLoadPng',
      'VipsForeignLoadRaw',
    ],
  });
}
