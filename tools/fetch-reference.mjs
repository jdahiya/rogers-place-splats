// Downloads openly licensed reference photos from Wikimedia Commons into reference/ (git-ignored),
// with CREDITS.csv recording author, licence and source for each. The photos are visual reference
// only; they are not part of the published site.
// Usage: node tools/fetch-reference.mjs [--width=2048] [Category_Name ...]
// With no categories it fetches the Rogers Place set. Only files directly in each category are
// fetched (not subcategories).
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'rogers-place-splats reference fetch (https://github.com/jdahiya/rogers-place-splats)';
const args = process.argv.slice(2);
const width = Number(args.find((a) => a.startsWith('--width='))?.slice(8) || 2048);
const named = args.filter((a) => !a.startsWith('--'));
const CATEGORIES = named.length ? named : ['Rogers_Place', 'Interior_of_Rogers_Place', 'Rogers_Place_under_construction', 'Events_at_Rogers_Place'];
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

const HEADER = ['category', 'file', 'title', 'author', 'licence', 'licence_url', 'date', 'source'];
const rows = [];
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
    const row = [category, `${category}/${file}`, page.title, stripHtml(meta.Artist?.value), meta.LicenseShortName?.value, meta.LicenseUrl?.value, stripHtml(meta.DateTimeOriginal?.value), info.descriptionurl];
    const exists = await access(join(dir, file)).then(() => true, () => false);
    if (exists) {
      rows.push(row);
      continue;
    }
    try {
      // Wikimedia rate-limits image downloads: back off and retry on 429.
      let res;
      for (let attempt = 0; attempt < 6; attempt++) {
        res = await fetch(src, { headers: { 'User-Agent': UA } });
        if (res.status !== 429) break;
        const wait = Number(res.headers.get('retry-after')) * 1000 || 4000 * 2 ** attempt;
        await sleep(wait);
      }
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(dir, file), buf);
      saved++;
      bytes += buf.length;
      rows.push(row);
    } catch (err) {
      console.warn(`  skipped ${page.title}: ${err.message}`);
    }
    await sleep(1000);
  }
}
// Merge with earlier runs: keep their rows for other categories, replace rows for these ones.
let kept = [];
try {
  const old = (await readFile(join(root, 'CREDITS.csv'), 'utf8')).trim().split('\n').slice(1);
  kept = old.filter((line) => !CATEGORIES.some((c) => line.startsWith(`"${c}",`)));
} catch {
  // First run: nothing to merge.
}
const lines = [HEADER.map(csv).join(','), ...kept, ...rows.map((r) => r.map(csv).join(','))];
await writeFile(join(root, 'CREDITS.csv'), lines.join('\n') + '\n');
console.log(`Saved ${saved} photos, ${(bytes / 1048576).toFixed(0)} MB, credits in reference/CREDITS.csv`);
