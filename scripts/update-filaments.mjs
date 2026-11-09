#!/usr/bin/env node
// Downloads SpoolmanDB's compiled filaments.json and writes the compact catalog
// the app ships with (src/lib/server/filaments/catalog.json).
// SpoolmanDB: https://github.com/Donkie/SpoolmanDB (MIT, see THIRD_PARTY.md).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const SOURCE_URL = 'https://donkie.github.io/SpoolmanDB/filaments.json';
const OUT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../src/lib/server/filaments/catalog.json'
);

const SUPPLEMENT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../src/lib/server/filaments/supplement.json'
);

const SOURCE_BASE = 'SpoolmanDB (https://github.com/Donkie/SpoolmanDB)';

const cmp = (a, b) =>
	a.localeCompare(b, 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

function hex(v) {
	if (typeof v !== 'string') return null;
	const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
	return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * Normalise the SpoolmanDB array (one row per brand/material/color/size) into
 * the nested catalog. Only 1.75 mm rows are kept, duplicates by
 * brand+material+color name are merged (first wins), everything is sorted.
 */
export function normalise(rows, { fetchedAt = new Date().toISOString() } = {}) {
	const brands = new Map();
	for (const r of Array.isArray(rows) ? rows : []) {
		if (!r || Number(r.diameter) !== 1.75) continue;
		const brand = String(r.manufacturer ?? '').trim();
		const material = String(r.material ?? '').trim();
		const name = String(r.name ?? '').trim();
		if (!brand || !material || !name) continue;
		const hexes = Array.isArray(r.color_hexes) ? r.color_hexes.map(hex).filter(Boolean) : [];
		const main = hex(r.color_hex) ?? hexes[0] ?? null;
		if (!main) continue;
		const color = { name, hex: main };
		if (hexes.length > 1) color.hexes = hexes;
		if (r.finish) color.finish = String(r.finish);
		if (r.translucent) color.translucent = true;
		if (r.glow) color.glow = true;
		if (Number.isFinite(r.weight) && r.weight > 0 && r.weight !== 1000) color.weightG = r.weight;
		const mats = brands.get(brand) ?? new Map();
		brands.set(brand, mats);
		const cols = mats.get(material) ?? new Map();
		mats.set(material, cols);
		if (!cols.has(name.toLowerCase())) cols.set(name.toLowerCase(), color);
	}
	return {
		source: SOURCE_BASE,
		license: 'MIT',
		fetchedAt,
		brands: [...brands.keys()].sort(cmp).map((name) => ({
			name,
			materials: [...brands.get(name).keys()].sort(cmp).map((material) => ({
				material,
				colors: [...brands.get(name).get(material).values()].sort((a, b) => cmp(a.name, b.name))
			}))
		}))
	};
}

const lc = (s) => String(s).trim().toLowerCase();

/**
 * Merge the committed vendor supplement (src/lib/server/filaments/supplement.json, written by
 * scripts/fetch-vendor-filaments.mjs) into a freshly normalised SpoolmanDB catalog, so regenerating the
 * catalog never loses it. Brands and materials match case-insensitively. For a color that exists in both
 * (same brand + material + color name) SpoolmanDB wins; the supplement only adds what is missing.
 * Pure: returns a new catalog and does not touch its inputs. `source` names every contributing vendor store.
 */
export function mergeSupplement(catalog, supplement) {
	const vendors = (Array.isArray(supplement?.brands) ? supplement.brands : []).filter(
		(b) => b && b.name && Array.isArray(b.materials)
	);
	const brands = new Map();
	for (const b of catalog.brands) {
		const mats = new Map();
		for (const m of b.materials)
			mats.set(lc(m.material), { material: m.material, colors: [...m.colors] });
		brands.set(lc(b.name), { name: b.name, mats });
	}
	for (const v of vendors) {
		const brand = brands.get(lc(v.name)) ?? { name: v.name, mats: new Map() };
		brands.set(lc(v.name), brand);
		for (const m of v.materials) {
			const mat = brand.mats.get(lc(m.material)) ?? { material: m.material, colors: [] };
			brand.mats.set(lc(m.material), mat);
			const have = new Set(mat.colors.map((c) => lc(c.name)));
			for (const c of m.colors ?? []) {
				if (!c?.name || !hex(c.hex) || have.has(lc(c.name))) continue;
				have.add(lc(c.name));
				mat.colors.push({ ...c, hex: hex(c.hex) });
			}
		}
	}
	const names = vendors.map((v) => v.name);
	return {
		...catalog,
		source: names.length
			? `${SOURCE_BASE}; vendor store catalogs: ${vendors.map((v) => `${v.name} (${v.sourceUrl})`).join(', ')}`
			: catalog.source,
		brands: [...brands.values()]
			.sort((a, b) => cmp(a.name, b.name))
			.map((b) => ({
				name: b.name,
				materials: [...b.mats.values()]
					.sort((x, y) => cmp(x.material, y.material))
					.map((m) => ({
						material: m.material,
						colors: [...m.colors].sort((x, y) => cmp(x.name, y.name))
					}))
			}))
	};
}

async function readSupplement() {
	try {
		return JSON.parse(await readFile(SUPPLEMENT, 'utf8'));
	} catch {
		return { brands: [] };
	}
}

async function main() {
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
	const catalog = mergeSupplement(normalise(await res.json()), await readSupplement());
	await mkdir(dirname(OUT), { recursive: true });
	await writeFile(OUT, JSON.stringify(catalog) + '\n');
	const mats = catalog.brands.reduce((n, b) => n + b.materials.length, 0);
	const cols = catalog.brands.reduce(
		(n, b) => n + b.materials.reduce((m, x) => m + x.colors.length, 0),
		0
	);
	console.log(`${catalog.brands.length} brands, ${mats} materials, ${cols} colors -> ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
