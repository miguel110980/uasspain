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
      const inlineStyles = [...html.matchAll(/<style data-stylesheet="([^"]+)">([\s\S]*?)<\/style>/g)];
      for (const [, href, contents] of inlineStyles) {
        if (!href.startsWith('/assets/') || href.includes('..')) throw new Error(`Invalid inline stylesheet: ${filename}`);
        let actual = await readFile(path.join('dist', href.slice(1)), 'utf8');
        for (const font of [...actual.matchAll(/url\((\/fonts\/[^)]+-critical\.woff2)\)/g)]) {
          const bytes = await readFile(path.join('dist', font[1].slice(1)));
          actual = actual.replaceAll(font[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
        }
        if (contents !== actual.replace(/<\/style/gi, '<\\/style')) throw new Error(`Inline stylesheet differs from build asset: ${filename}`);
      }
      // The static 404 shell contains literal HTML, not a prerendered route component.
      if (path.basename(filename) !== '404.html' && !html.includes('data-prerendered="home"') && /<h1\b/.test(html) && !/<link[^>]+rel="modulepreload"/.test(html)) throw new Error(`Missing public route preload in ${filename}`);
      for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) await access(path.join('dist', asset));
      const styles = new Set([
        ...[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(match => match[1]),
        ...inlineStyles.map(match => match[1]),
      ]);
      const visited = new Set();
      function checkStyles(key) {
        if (visited.has(key)) return;
        visited.add(key);
        const module = manifest[key];
        for (const css of module.css || []) {
          if (!styles.has(`/${css}`)) throw new Error(`Missing initial stylesheet in ${filename}: ${css}`);
        }
        (module.imports || []).forEach(checkStyles);
      }
      if (html.includes('data-prerendered="home"')) checkStyles('src/pages/Home.tsx');
      for (const [, file] of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+)"/g)) {
        const key = Object.keys(manifest).find(key => manifest[key].file === file);
        if (!key) throw new Error(`Untracked module preload in ${filename}: ${file}`);
        checkStyles(key);
      }
    }
  }
}
await checkHtml('dist');
const version = JSON.parse(await readFile('dist/version.json', 'utf8'));
if (!/^[a-f0-9-]{36}$/.test(version.buildId)) throw new Error('Missing release identifier');
console.log(`Verified ${Object.keys(manifest).length} manifest entries, dynamic dependencies and HTML assets.`);
