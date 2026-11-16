import { access, copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const brandSource = fileURLToPath(new URL('../../../docs/assets/brand/', import.meta.url));
const brandTarget = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const iconSource = fileURLToPath(new URL('../../../public/app-icon.svg', import.meta.url));
const iconTarget = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url));
const bullSource = fileURLToPath(new URL('../../../public/bull-avatar.png', import.meta.url));
const bullTarget = fileURLToPath(new URL('../public/screenshots/bull-avatar.png', import.meta.url));

await mkdir(brandTarget, { recursive: true });

try {
  await access(brandSource);
  for (const name of await readdir(brandSource)) {
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    await copyFile(`${brandSource}/${name}`, `${brandTarget}/${name}`);
  }
} catch {
  // Brand assets are optional until product shots are replaced.
}

await copyFile(iconSource, iconTarget);
await copyFile(bullSource, bullTarget);
