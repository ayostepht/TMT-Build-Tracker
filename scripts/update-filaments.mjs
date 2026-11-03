#!/usr/bin/env node
// Downloads SpoolmanDB's compiled filaments.json and writes the compact catalog
// the app ships with (src/lib/server/filaments/catalog.json).
// SpoolmanDB: https://github.com/Donkie/SpoolmanDB (MIT, see THIRD_PARTY.md).
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const SOURCE_URL = 'https://donkie.github.io/SpoolmanDB/filaments.json';
const OUT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../src/lib/server/filaments/catalog.json'
);

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
		source: 'SpoolmanDB (https://github.com/Donkie/SpoolmanDB)',
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

async function main() {
	const res = await fetch(SOURCE_URL);
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
	const catalog = normalise(await res.json());
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
