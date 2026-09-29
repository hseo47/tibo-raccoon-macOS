import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';

test('the approved SVGs reproduce six smooth, embedded menu-bar icons', async () => {
  const manifest = await Bun.file('assets/icons/sha256.json').json() as Record<string, string>;
  const hashes = new Set<string>();

  for (const state of ['calm', 'unread', 'offline'] as const) {
    const source = await Bun.file(`previews/v2-raccoon/${state}.svg`).text();
    expect(source).toContain('viewBox="0 0 31 23"');
    expect(source).toContain('fill="#fff"');
    expect(source).not.toContain('stroke=');

    for (const appearance of ['light', 'dark'] as const) {
      const svg = appearance === 'dark' ? source : source
        .replaceAll('#34383b', '#33383c')
        .replaceAll('#c9eee4', '#bde4d8')
        .replaceAll('#fa936d', '#dc7056')
        .replaceAll('#ffe4aa', '#ffdc93');
      const expected = await sharp(Buffer.from(svg), { density: 384 })
        .resize(31, 23, { fit: 'fill', kernel: 'lanczos3' })
        .withMetadata({ density: 96 })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const filename = `${state}-${appearance}.png`;
      const actual = Buffer.from(await Bun.file(`assets/icons/${filename}`).arrayBuffer());
      const hash = new Bun.CryptoHasher('sha256').update(actual).digest('hex');
      const { data, info } = await sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const metadata = await sharp(actual).metadata();
      const alpha = Array.from({ length: info.width * info.height }, (_, i) => data[i * 4 + 3]);

      expect(actual).toEqual(expected);
      expect(actual).toEqual(Buffer.from(ICON_BASE64[state][appearance], 'base64'));
      expect(hash).toBe(manifest[filename]!);
      expect(hash).toBe(ICON_SHA256[state][appearance]);
      expect([info.width, info.height]).toEqual([31, 23]);
      expect(metadata.density).toBe(96);
      expect(alpha).toContain(0);
      expect(alpha.some((value) => value !== undefined && value > 0 && value < 255)).toBe(true);
      hashes.add(hash);
    }
  }
  expect(hashes.size).toBe(6);
});
