import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
for (const [name, entry] of Object.entries(manifest)) {
  for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
    if (!file || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error(`Invalid build asset: ${name}`);
    await access(path.join('dist', file));
  }
  for (const dependency of [...(entry.imports || []), ...(entry.dynamicImports || [])]) {
    if (!manifest[dependency]) throw new Error(`Missing chunk dependency: ${name} -> ${dependency}`);
  }
}
async function checkHtml(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) await checkHtml(filename);
    else if (entry.name.endsWith('.html')) {
      const html = await readFile(filename, 'utf8');
      for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) await access(path.join('dist', asset));
    }
  }
}
await checkHtml('dist');
const version = JSON.parse(await readFile('dist/version.json', 'utf8'));
if (!/^[a-f0-9-]{36}$/.test(version.buildId)) throw new Error('Missing release identifier');
console.log(`Verified ${Object.keys(manifest).length} manifest entries, dynamic dependencies and HTML assets.`);
