import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ImageProcessingError,
  imagePolicy,
  processAutographImage,
  restrictWorkerImageLoaders,
} from './image-processing';

function drawing(width: number, height: number, transparent = false): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = transparent ? 0 : 255;
    pixels[i + 1] = transparent ? 0 : 255;
    pixels[i + 2] = transparent ? 0 : 255;
    pixels[i + 3] = transparent ? 0 : 255;
  }
  for (let x = 20; x < width - 20; x++) {
    const y = Math.min(height - 10, 20 + Math.floor(x / 3));
    const offset = (y * width + x) * 4;
    pixels[offset] = transparent ? 200 : 0;
    pixels[offset + 1] = transparent ? 10 : 0;
    pixels[offset + 2] = transparent ? 20 : 0;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

async function image(
  format: 'png' | 'jpeg',
  transparent = false,
  orientation?: number,
) {
  let pipeline = sharp(drawing(180, 110, transparent), {
    raw: { width: 180, height: 110, channels: 4 },
  });
  if (orientation)
    pipeline = pipeline.withMetadata({ orientation }).withExifMerge({
      IFD0: {
        Artist: 'private camera',
        ImageDescription: 'GPS-like private location',
      },
    });
  return format === 'png'
    ? pipeline.png().toBuffer()
    : pipeline.jpeg().toBuffer();
}

describe('private autograph image processing', () => {
  it('extracts dark photo ink and strips EXIF from a JPEG with orientation', async () => {
    const input = await image('jpeg', false, 6);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const output = await processAutographImage(input, 'photo', 'image/jpeg');
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(output.width).toBeLessThan(output.height);
    expect(output.width).toBeLessThanOrEqual(imagePolicy.maxOutputDimension);
    const raw = await sharp(output.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = [...raw.data.filter((_, index) => index % 4 === 3)];
    expect(alpha.some((value) => value === 0)).toBe(true);
    expect(alpha.some((value) => value > 200)).toBe(true);
  });

  it('normalizes a transparent canvas PNG without photo thresholding', async () => {
    const output = await processAutographImage(
      await image('png', true),
      'canvas',
      'image/png',
    );
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.hasAlpha).toBe(true);
    const raw = await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    expect(raw.includes(200)).toBe(true);
  });

  it('rejects spoofing, malformed bytes, unsupported formats, and blank sheets', async () => {
    await expect(
      processAutographImage(await image('jpeg'), 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(
      processAutographImage(Buffer.from('not a png'), 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(
      processAutographImage(
        Buffer.from([255, 216, 255, 0]),
        'photo',
        'image/jpeg',
      ),
    ).rejects.toBeInstanceOf(ImageProcessingError);
    const gif = await sharp(drawing(180, 110), {
      raw: { width: 180, height: 110, channels: 4 },
    })
      .gif()
      .toBuffer();
    await expect(
      processAutographImage(gif, 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_FORMAT' });
    const blank = await sharp({
      create: { width: 180, height: 110, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(
      processAutographImage(blank, 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'EMPTY_AUTOGRAPH' });
  });

  it('rejects compressed images with excessive pixels before raw decoding', async () => {
    const huge = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(
      processAutographImage(huge, 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS_EXCEEDED' });
  });

  it('still processes JPEG/PNG and trusted raw output with worker loader restrictions', async () => {
    const png = await image('png');
    const jpeg = await image('jpeg');
    restrictWorkerImageLoaders();
    expect(
      (await processAutographImage(png, 'photo', 'image/png')).bytes.length,
    ).toBeGreaterThan(0);
    expect(
      (await processAutographImage(jpeg, 'photo', 'image/jpeg')).bytes.length,
    ).toBeGreaterThan(0);
  });
});
