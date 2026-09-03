import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const publicDir = join(root, 'public');
const outputDir = join(root, 'dist-upload');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css', 'favicon.svg']) {
  await cp(join(publicDir, file), join(outputDir, file));
}

const worker = await readFile(join(root, 'functions', 'api', '[[path]].js'), 'utf8');
await writeFile(join(outputDir, '_worker.js'), worker, 'utf8');

console.log('Cloudflare local upload assets written to dist-upload/');
