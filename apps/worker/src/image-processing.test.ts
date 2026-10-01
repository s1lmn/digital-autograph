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

type PaperScene = {
  paper?: number;
  blue?: boolean;
  gradient?: boolean;
  shadow?: boolean;
  noise?: boolean;
  blank?: boolean;
  thin?: boolean;
};

async function paperPhoto(scene: PaperScene) {
  const width = 320;
  const height = 192;
  const pixels = Buffer.alloc(width * height * 3);
  let inkPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lighting =
        (scene.gradient ? (45 * x) / (width - 1) - 22.5 : 0) -
        (scene.shadow ? 35 * Math.exp(-(((x - 90) / 65) ** 2)) : 0);
      // A repeatable small sensor/noise pattern; JPEG adds codec artifacts.
      const noise = scene.noise ? ((x * 17 + y * 31) % 7) - 3 : 0;
      const paper = Math.round(
        Math.max(0, Math.min(255, (scene.paper ?? 245) + lighting + noise)),
      );
      const inkY = 82 + Math.round(9 * Math.sin((x - 96) / 15));
      const stroke =
        !scene.blank &&
        x >= 96 &&
        x <= 223 &&
        y >= inkY &&
        y < inkY + (scene.thin ? 1 : 3);
      const offset = (y * width + x) * 3;
      const rgb = stroke
        ? scene.blue
          ? [25, 40, 105]
          : [30, 30, 30]
        : [paper, paper - 2, paper - 5];
      for (let c = 0; c < 3; c++) pixels[offset + c] = rgb[c] ?? 0;
      if (stroke) inkPixels++;
    }
  }
  const pipeline = sharp(pixels, { raw: { width, height, channels: 3 } });
  return {
    bytes: scene.noise
      ? await pipeline.jpeg({ quality: 85 }).toBuffer()
      : await pipeline.png().toBuffer(),
    contentType: scene.noise ? 'image/jpeg' : 'image/png',
    inkPixels,
  };
}

describe('background-relative paper cleanup', () => {
  it.each([
    ['bright white paper', { paper: 255 }],
    [
      'dim off-white paper (old absolute thresholds fill the frame)',
      { paper: 172 },
    ],
    ['dark blue pen', { paper: 170, blue: true }],
    ['uneven lighting', { paper: 175, gradient: true }],
    ['room shadow', { paper: 175, shadow: true }],
    [
      'JPEG camera noise',
      { paper: 170, noise: true, gradient: true, shadow: true },
    ],
    ['one-pixel thin strokes', { paper: 170, thin: true }],
  ] as const)('preserves ink and removes %s', async (_, scene) => {
    const input = await paperPhoto(scene);
    const output = await processAutographImage(
      input.bytes,
      'photo',
      input.contentType,
    );
    expect(output.width).toBeGreaterThanOrEqual(128 + 32);
    expect(output.width).toBeLessThan(180);
    expect(output.height).toBeLessThan(70);
    const { data, info } = await sharp(output.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let foreground = 0;
    let soft = 0;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(0);
      expect(data[i + 1]).toBe(0);
      expect(data[i + 2]).toBe(0);
      const alpha = data[i + 3] ?? 0;
      if (alpha >= 250) opaque++;
      if (alpha >= imagePolicy.cropAlphaThreshold) foreground++;
      if (alpha > 0 && alpha < 255) soft++;
    }
    expect(opaque).toBeGreaterThan(input.inkPixels * 0.8);
    // Crop is near the known ink support, and most of the cropped output is clear.
    expect(foreground / (info.width * info.height)).toBeLessThan(0.15);
    expect(foreground).toBeLessThan(input.inkPixels * 2);
    if ((scene as PaperScene).noise) expect(soft).toBeGreaterThan(0);
  });

  it.each([
    ['bright', { paper: 255 }],
    ['dim', { paper: 170 }],
    ['gradient and shadow', { paper: 170, gradient: true, shadow: true }],
    ['noisy JPEG', { paper: 170, noise: true, gradient: true, shadow: true }],
  ] as const)('rejects a blank %s sheet', async (_, scene) => {
    const input = await paperPhoto({ ...scene, blank: true });
    await expect(
      processAutographImage(input.bytes, 'photo', input.contentType),
    ).rejects.toMatchObject({ code: 'EMPTY_AUTOGRAPH' });
  });

  it('rejects a nearly filled foreground instead of returning a black rectangle', async () => {
    const width = 320,
      height = 192;
    const data = Buffer.alloc(width * height * 3);
    // Every tile contains enough paper to estimate it, but 70% is dark.
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value = x % 10 < 7 ? 20 : 180;
        data.fill(value, (y * width + x) * 3, (y * width + x + 1) * 3);
      }
    const bytes = await sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    await expect(
      processAutographImage(bytes, 'photo', 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('keeps canvas colors, partial alpha and crop semantics unchanged', async () => {
    const width = 60,
      height = 50;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 20; y < 24; y++)
      for (let x = 25; x < 30; x++) {
        const i = (y * width + x) * 4;
        pixels.set([20, 80, 160, 128], i);
      }
    const input = await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const output = await processAutographImage(input, 'canvas', 'image/png');
    expect([output.width, output.height]).toEqual([37, 36]);
    const raw = await sharp(output.bytes).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < 36; y++)
      for (let x = 0; x < 37; x++) {
        const expected =
          x >= 16 && x < 21 && y >= 16 && y < 20
            ? [20, 80, 160, 128]
            : [0, 0, 0, 0];
        expect([
          ...raw.subarray((y * 37 + x) * 4, (y * 37 + x + 1) * 4),
        ]).toEqual(expected);
      }
  });
});
