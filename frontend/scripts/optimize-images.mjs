import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/images');
for (const theme of ['claro', 'oscuro']) {
  for (const width of [640, 1280, 1672]) {
    await sharp(path.join(folder, `hero_${theme}.png`)).resize({ width, withoutEnlargement: true })
      .webp({ quality: 72, effort: 6 }).toFile(path.join(folder, `hero-${theme}-${width}.webp`));
  }
  // Same centered crop as object-cover on a portrait phone, sent at its actual size.
  for (const width of [320, 472]) {
    await sharp(path.join(folder, `hero_${theme}.png`)).resize(width, Math.round(width * 941 / 472), { fit: 'cover', position: 'centre' })
      .webp({ quality: 72, effort: 6 }).toFile(path.join(folder, `hero-${theme}-portrait-${width}.webp`));
  }
}
for (const width of [64, 128, 256]) {
  await sharp(path.join(folder, 'logo.png')).resize({ width }).webp({ quality: 80, effort: 6 })
    .toFile(path.join(folder, `logo-${width}.webp`));
}
for (const width of [32, 192, 512]) {
  await sharp(path.join(folder, 'icon.webp')).resize(width, width, { fit: 'contain' })
    .webp({ quality: 80, effort: 6 }).toFile(path.join(folder, `icon-${width}.webp`));
}
for (const name of ['about', 'tech']) {
  for (const width of [480, 960, 1280]) {
    await sharp(path.join(folder, `${name}.jpg`)).resize({ width, withoutEnlargement: true }).webp({ quality: 78, effort: 6 })
      .toFile(path.join(folder, `${name}-${width}.webp`));
  }
}
console.log('Generated responsive WebP assets from the original images.');
