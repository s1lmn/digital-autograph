import sharp from 'sharp';
import type { Metadata, OutputInfo } from 'sharp';
import type { AutographSource } from '@digital-autograph/domain';

export const imagePolicy = {
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 20_000_000,
  maxInputDimension: 10_000,
  maxOutputDimension: 2048,
  maxOutputBytes: 10 * 1024 * 1024,
  photoOpaqueLuminance: 190,
  photoTransparentLuminance: 235,
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const originalAlpha = pixels[offset + 3] ?? 0;
      let alpha = originalAlpha;
      if (source === 'photo') {
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        alpha = Math.round(
          originalAlpha *
            Math.max(
              0,
              Math.min(
                1,
                (imagePolicy.photoTransparentLuminance - luminance) /
                  (imagePolicy.photoTransparentLuminance -
                    imagePolicy.photoOpaqueLuminance),
              ),
            ),
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
