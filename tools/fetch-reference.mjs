// Downloads openly licensed reference photos of Rogers Place from Wikimedia Commons into
// reference/ (git-ignored), with CREDITS.csv recording author, licence and source for each.
// The photos are used as visual reference only; they are not part of the published site.
// Usage: node tools/fetch-reference.mjs [maxWidth=2048]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'rogers-place-splats reference fetch (https://github.com/jdahiya/rogers-place-splats)';
const CATEGORIES = ['Rogers_Place', 'Interior_of_Rogers_Place', 'Rogers_Place_under_construction', 'Events_at_Rogers_Place'];
const width = Number(process.argv[2] || 2048);
const root = join(fileURLToPath(new URL('..', import.meta.url)), 'reference');

const stripHtml = (s = '') => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

async function filesIn(category) {
  const out = [];
  let cont = {};
  do {
    const j = await api({
      action: 'query', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '100',
      prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(width),
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|DateTimeOriginal|ImageDescription', ...cont,
    });
    out.push(...Object.values(j.query?.pages ?? {}));
    cont = j.continue ?? null;
  } while (cont);
  return out;
}

const rows = [['category', 'file', 'title', 'author', 'licence', 'licence_url', 'date', 'source']];
let saved = 0, bytes = 0;
for (const category of CATEGORIES) {
  const dir = join(root, category);
  await mkdir(dir, { recursive: true });
  const files = await filesIn(category);
  console.log(`${category}: ${files.length} files`);
  for (const page of files) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const name = page.title.replace(/^File:/, '').replace(/[\\/:*?"<>|]/g, '_');
    const src = info.thumburl || info.url;
    const ext = (src.match(/\.(jpe?g|png|webp|tiff?|gif)$/i)?.[0] ?? '.jpg').toLowerCase();
    const file = name.replace(/\.[^.]+$/, '') + ext;
    try {
      const res = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(dir, file), buf);
      saved++;
      bytes += buf.length;
      rows.push([category, `${category}/${file}`, page.title, stripHtml(meta.Artist?.value), meta.LicenseShortName?.value, meta.LicenseUrl?.value, stripHtml(meta.DateTimeOriginal?.value), info.descriptionurl]);
    } catch (err) {
      console.warn(`  skipped ${page.title}: ${err.message}`);
    }
    await sleep(150);
  }
}
await writeFile(join(root, 'CREDITS.csv'), rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
console.log(`Saved ${saved} photos, ${(bytes / 1048576).toFixed(0)} MB, credits in reference/CREDITS.csv`);
