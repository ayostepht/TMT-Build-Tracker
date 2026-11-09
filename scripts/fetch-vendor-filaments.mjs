#!/usr/bin/env node
// Builds the curated vendor supplement (src/lib/server/filaments/supplement.json) from Shopify stores'
// public product JSON. `npm run filaments:update` merges the supplement into catalog.json, so colors the
// SpoolmanDB lacks (new Overture lines, Schoolhouse Spools) survive a catalog regeneration.
//
//   node scripts/fetch-vendor-filaments.mjs [--brand overture|schoolhouse]... [--from-dir DIR]
//        [--hex-overrides FILE] [--delay MS] [--out FILE]
//
// Online: GET <store>/products.json?limit=250&page=N (polite delay, honours Retry-After on HTTP 429).
// Offline: --from-dir reads saved JSON instead (DIR/<brand>.json or DIR/<brand>.<page>.json, each
// {"products":[...]}), so nothing is fetched. Colors without a hex are left out and listed on stderr.
//
// Hex sources, best first: a hex written in the variant's option value or a product tag ("hexSource":
// "store"), then --hex-overrides ("hexSource" taken from the file: "store" for a hex copied from the
// store, "image" for one sampled from a product photo). Never guessed from the color name.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const OUT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../src/lib/server/filaments/supplement.json'
);

export const USER_AGENT =
	'TMT-Build-Tracker filament catalog update (open-source; https://github.com/ayostepht/TMT-Build-Tracker)';

/** The stores in the supplement. `key` is the --brand / file prefix. */
export const VENDORS = {
	overture: {
		name: 'Overture',
		host: 'https://overture3d.com',
		// Product pages (the store's /products.json is rate limited). `label` goes in front of each color name.
		// The high-speed PETG is Overture's current PETG (same colors as the older SpoolmanDB "PETG"), so it
		// keeps the plain names and merges with them; TPU names follow SpoolmanDB's "High Speed 95A <color>".
		pages: [
			{ handle: 'overture-high-speed-petg', material: 'PETG' },
			{ handle: 'overture-high-speed-petg-refill-3d-printer-filament-1-75mm', material: 'PETG' },
			{
				handle: 'overture-high-speed-tpu-3d-printer-filament-1-75mm',
				material: 'TPU',
				label: 'High Speed 95A'
			},
			{ handle: 'overture-tpu', material: 'TPU', label: '95A' }
		]
	},
	schoolhouse: {
		name: 'Schoolhouse Spools',
		host: 'https://schoolhousespools.com',
		pages: [
			{ handle: 'petg-standard', material: 'PETG' },
			// Refill photos show the spool front-on: sample the wound ring, not the side of a spool.
			{ handle: 'petg-refill', material: 'PETG', box: [0.12, 0.35, 0.26, 0.65] },
			{ handle: 'petg-matte', material: 'PETG', label: 'Matte PETG', finish: 'matte' },
			{ handle: 'pctg', material: 'PCTG' },
			{ handle: 'tpu', material: 'TPU', label: '95A' }
		]
	}
};

// Not filament. Only PETG and TPU are kept (the chair slot materials); PLA is deliberately not added.
const NON_FILAMENT =
	/\b(dryer|dry box|drybox|gift ?card|sample|bundle|combo|kit|merch|t-?shirt|hoodie|hat|sticker|nozzle|build ?plate|print ?bed|spool ?holder|storage|rack|tool|scraper|glue|adhesive|printer|hotend|subscription|pack of|variety|assorted|mystery)\b/i;

const lc = (s) =>
	String(s ?? '')
		.trim()
		.toLowerCase();
const titleCase = (s) => s.replace(/\b([a-z])([a-z]*)/g, (_, a, b) => a.toUpperCase() + b);

/** A `#rrggbb` found in text (the `#` is required, so product codes are not mistaken for colors). */
export function hexOf(v) {
	const m = /#([0-9a-f]{6})(?![0-9a-f])/i.exec(String(v ?? ''));
	return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * Which catalog material a product is, plus the "line" label put in front of each color name, or
 * `{ skip }` with the reason. High-speed lines keep the plain material (PETG, TPU) so the picker's
 * material families and slot rules apply unchanged; the color name carries "HS".
 */
export function classifyProduct(product, brand = '') {
	const title = String(product?.title ?? '');
	const text = `${title} ${product?.product_type ?? ''}`;
	if (NON_FILAMENT.test(title)) return { skip: 'not a filament spool' };
	const t = lc(text).replace(lc(brand), ' ');
	let material;
	if (/\b(petg|pctg)\b/.test(t)) material = 'PETG';
	else if (/\btpu\b/.test(t)) material = 'TPU';
	else return { skip: 'material not used (only PETG and TPU are slot materials)' };

	const highSpeed = /\b(high[\s-]?speed|hs|rapid)\b/.test(t);
	const finish = /\bsilk\b/.test(t) ? 'silk' : /\bmatte?\b/.test(t) ? 'matte' : undefined;
	let hardness = null;
	if (material === 'TPU') {
		const h = /(?<![\d.])(\d{2,3})\s?-?([ad])\b/i.exec(text);
		if (!h) return { skip: 'TPU hardness not stated' };
		hardness = `${h[1]}${h[2].toUpperCase()}`;
	}
	// Other qualifiers worth keeping in the name so name-based exclusions still see them.
	const extra = [];
	for (const w of [
		'rock',
		'marble',
		'sparkle',
		'glitter',
		'galaxy',
		'glow',
		'wood',
		'carbon fiber',
		'rainbow',
		'gradient',
		'dual color',
		'tri-color'
	])
		if (t.includes(w)) extra.push(titleCase(w));
	const parts = [];
	if (highSpeed) parts.push('HS');
	if (finish) parts.push(`${titleCase(finish)} ${material}`);
	parts.push(...extra);
	if (hardness) parts.push(hardness);
	return { material, finish, highSpeed, label: parts.join(' ') };
}

function colorOptionIndex(product) {
	const i = (product.options ?? []).findIndex((o) => /colou?r/i.test(o?.name ?? ''));
	return i;
}

/** Distinct color names of a product from its variants ("Color" option, else the single-option value). */
export function productColors(product) {
	let idx = colorOptionIndex(product);
	if (
		idx < 0 &&
		(product.options ?? []).length === 1 &&
		!/size|weight|title/i.test(product.options[0]?.name ?? '')
	)
		idx = 0;
	const seen = new Map();
	for (const v of product.variants ?? []) {
		const raw = idx >= 0 ? v[`option${idx + 1}`] : null;
		if (!raw || /^default title$/i.test(raw)) continue;
		const hex = hexOf(raw);
		const name = String(raw)
			.replace(/\s*[([]?#[0-9a-f]{6}[)\]]?/i, '')
			.replace(/\s*[-/|]\s*$/, '')
			.trim();
		if (name && !seen.has(lc(name))) seen.set(lc(name), { name, hex });
	}
	const image = (product.images ?? [])[0]?.src;
	return [...seen.values()].map((c) => ({ ...c, image }));
}

/** Turn a product's color names into catalog colors; reports what it could not place. */
export function convertProducts(products, brand, { hexOverrides = {}, skipped = [] } = {}) {
	const mats = new Map();
	for (const p of products) {
		const cls = classifyProduct(p, brand);
		if (cls.skip) {
			skipped.push({ product: p.title, reason: cls.skip });
			continue;
		}
		const colors = productColors(p);
		if (!colors.length) {
			skipped.push({ product: p.title, reason: 'no color variants' });
			continue;
		}
		const tagHex = (name) => {
			for (const tag of Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(','))
				if (lc(tag).includes(lc(name)) && hexOf(tag)) return hexOf(tag);
			return null;
		};
		for (const c of colors) {
			const key = `${p.handle}|${c.name}`;
			const ov = hexOverrides[key];
			const hex = c.hex ?? tagHex(c.name) ?? hexOf(`#${String(ov?.hex ?? '').replace('#', '')}`);
			if (!hex) {
				skipped.push({
					product: p.title,
					color: c.name,
					reason: 'no hex (needs --hex-overrides)',
					image: c.image
				});
				continue;
			}
			const name = [cls.label, c.name].filter(Boolean).join(' ');
			const entry = {
				name,
				hex,
				hexSource:
					c.hex || tagHex(c.name)
						? 'store'
						: ['image', 'filascope'].includes(ov?.hexSource)
							? ov.hexSource
							: 'store'
			};
			if (cls.finish) entry.finish = cls.finish;
			if (/\b(transparent|translucent|clear)\b/i.test(c.name)) entry.translucent = true;
			if (/\bglow\b/i.test(`${c.name} ${cls.label}`)) entry.glow = true;
			const list = mats.get(cls.material) ?? new Map();
			mats.set(cls.material, list);
			if (!list.has(lc(name))) list.set(lc(name), entry);
		}
	}
	return [...mats.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([material, cols]) => ({
			material,
			colors: [...cols.values()].sort((a, b) => a.name.localeCompare(b.name))
		}));
}

/** Build one supplement brand from a vendor's products. */
export function buildSupplementBrand(vendorKey, products, opts = {}) {
	const v = VENDORS[vendorKey];
	return {
		name: v.name,
		sourceUrl: v.host,
		fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
		materials: convertProducts(products, v.name, opts)
	};
}

/** Replace/add the given brands in an existing supplement, keeping the others; sorted by name. */
export function mergeBrands(existing, brands) {
	const keep = (existing?.brands ?? []).filter(
		(b) => !brands.some((n) => lc(n.name) === lc(b.name))
	);
	return { brands: [...keep, ...brands].sort((a, b) => a.name.localeCompare(b.name)) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch all pages of /products.json politely: fixed delay between requests, Retry-After on 429. */
export async function fetchProducts(
	host,
	{ delayMs = 4000, maxRetries = 6, fetchFn = fetch, wait = sleep } = {}
) {
	const all = [];
	for (let page = 1; page < 50; page++) {
		let res;
		for (let attempt = 0; ; attempt++) {
			res = await fetchFn(`${host}/products.json?limit=250&page=${page}`, {
				headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
			});
			if (res.status !== 429) break;
			if (attempt >= maxRetries)
				throw new Error(`${host}: still rate limited after ${maxRetries} retries`);
			const retry = Number(res.headers.get('retry-after'));
			await wait((Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000 * (attempt + 1));
		}
		if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
		const products = (await res.json()).products ?? [];
		all.push(...products);
		if (products.length < 250) break;
		await wait(delayMs);
	}
	return all;
}

async function readSaved(dir, key) {
	const files = (await readdir(dir))
		.filter((f) => new RegExp(`^${key}(\\.\\d+)?\\.json$`).test(f))
		.sort();
	if (!files.length) throw new Error(`No ${key}.json or ${key}.<page>.json in ${dir}`);
	const out = [];
	for (const f of files)
		out.push(...(JSON.parse(await readFile(join(dir, f), 'utf8')).products ?? []));
	return out;
}

const clean = (v) =>
	String(v ?? '')
		.replace(/\\u0026/g, '&')
		.replace(/\\\//g, '/')
		.trim();

/**
 * Colors of a Shopify product page, from what the theme embeds: the option swatch table
 * (`name: "X", colorHex: "#..."`, hex written by the merchant) and the variant photos in the analytics JSON.
 * Returns [{ name, hex?, image? }]; `hex` is only set when the store states one.
 */
export function parseProductPage(html) {
	const out = new Map();
	const add = (name, patch) => {
		name = clean(name).split(' / ')[0].trim();
		if (!name || /^(default title|\d+(\.\d+)?\s?(mm|kg))$/i.test(name)) return;
		out.set(lc(name), { ...(out.get(lc(name)) ?? { name }), ...patch });
	};
	const flat = html.replace(/\n/g, ' ');
	for (const m of flat.matchAll(
		/name:\s*"([^"]+)",\s*colorHex:\s*"(#[0-9a-fA-F]{6})"(?:,\s*swatchImageUrl:\s*"([^"]*)")?/g
	))
		add(m[1], { hex: m[2].toLowerCase() });
	// Variant objects: the image is optional, so match it inside one object (never across variants).
	for (const m of flat.matchAll(
		/"id":"\d+",(?:"image":\{"src":"([^"]+)"\},)?"sku":[^,]*,"title":"([^"]+)"/g
	))
		add(m[2], m[1] ? { image: clean(m[1]).replace(/^\/\//, 'https://') } : {});
	// A variant without its own photo reports the product's default one, shared by several colors:
	// keep a shared photo only for the color its file name mentions.
	const uses = new Map();
	for (const c of out.values()) if (c.image) uses.set(c.image, (uses.get(c.image) ?? 0) + 1);
	const squash = (v) => lc(v).replace(/[^a-z0-9]/g, '');
	for (const c of out.values())
		if (
			c.image &&
			uses.get(c.image) > 1 &&
			!squash(decodeURIComponent(c.image)).includes(squash(c.name))
		)
			delete c.image;
	return [...out.values()];
}

/**
 * Estimate the filament color from a product photo. `sharp` is optional (not a dependency); `box` is
 * [x0, y0, x1, y1] as fractions of the image, over the wound filament (the default suits a spool shot at an
 * angle, with the wound filament on the right). Inside it the black spool and the backdrop are told apart
 * from the filament by saturation: a colored filament is the median of its saturated pixels; a neutral
 * one (white, grey, black, natural) is the median of the lighter half of the box, because the box also
 * catches the dark flange. Always an estimate (hexSource "image").
 */
export async function sampleImageHex(buffer, sharp, box = [0.58, 0.25, 0.78, 0.7]) {
	const { data, info } = await sharp(buffer)
		.resize(400, 400, { fit: 'cover' })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const px = [];
	for (let y = Math.floor(box[1] * info.height); y < box[3] * info.height; y++)
		for (let x = Math.floor(box[0] * info.width); x < box[2] * info.width; x++) {
			const i = (y * info.width + x) * 3;
			px.push([data[i], data[i + 1], data[i + 2]]);
		}
	const sat = (p) => {
		const mx = Math.max(...p);
		return mx ? (mx - Math.min(...p)) / mx : 0;
	};
	const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
	const colored = px.filter((p) => sat(p) > 0.18 && Math.max(...p) > 50);
	const pool =
		colored.length >= px.length * 0.15
			? colored
			: [...px].sort((p, q) => lum(q) - lum(p)).slice(0, px.length >> 1);
	const med = (c) => pool.map((p) => p[c]).sort((p, q) => p - q)[pool.length >> 1];
	return '#' + [0, 1, 2].map((c) => med(c).toString(16).padStart(2, '0')).join('');
}

/**
 * Catalog materials from parsed product pages. `pages` = [{ cfg, colors }] (cfg from VENDORS[..].pages).
 * A hex the store writes for the color wins (Overture's option table). Shopify's built-in swatch colors are
 * generic taxonomy values (several colors share one), so they are not used. Otherwise `hexOverrides["handle|Color"]` (image-sampled, hexSource "image") is used. Colors without any
 * hex are reported in `skipped`, never guessed.
 */
export function convertPages(pages, { hexOverrides = {}, skipped = [] } = {}) {
	const mats = new Map();
	for (const { cfg, colors } of pages) {
		for (const c of colors) {
			const ov = hexOverrides[`${cfg.handle}|${c.name}`];
			const store = c.hex ?? null;
			const hex = store ?? hexOf(`#${String(ov?.hex ?? '').replace('#', '')}`);
			if (!hex) {
				skipped.push({ product: cfg.handle, color: c.name, reason: 'no hex', image: c.image });
				continue;
			}
			const name = [cfg.label, c.name].filter(Boolean).join(' ');
			const entry = {
				name,
				hex,
				hexSource: store ? 'store' : ov?.hexSource === 'filascope' ? 'filascope' : 'image'
			};
			const finish =
				cfg.finish ??
				(/\bmatte\b/i.test(c.name) ? 'matte' : /\bsilk\b/i.test(c.name) ? 'silk' : null);
			if (finish) entry.finish = finish;
			if (/\b(transparent|translucent|clear)\b/i.test(c.name)) entry.translucent = true;
			if (/\b(glow|luminous)\b/i.test(c.name)) entry.glow = true;
			const list = mats.get(cfg.material) ?? new Map();
			mats.set(cfg.material, list);
			if (!list.has(lc(name))) list.set(lc(name), entry);
		}
	}
	return [...mats.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([material, cols]) => ({
			material,
			colors: [...cols.values()].sort((a, b) => a.name.localeCompare(b.name))
		}));
}

function parseArgs(argv) {
	const a = { brands: [], delay: 8000 };
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		if (k === '--brand') a.brands.push(argv[++i]);
		else if (k === '--from-dir') a.dir = argv[++i];
		else if (k === '--pages-dir') a.pagesDir = argv[++i];
		else if (k === '--fetch-pages') a.fetchPages = true;
		else if (k === '--sample-images') a.sample = true;
		else if (k === '--images-dir') a.imagesDir = argv[++i];
		else if (k === '--hex-overrides') a.overrides = argv[++i];
		else if (k === '--delay') a.delay = Number(argv[++i]);
		else if (k === '--out') a.out = argv[++i];
		else throw new Error(`Unknown argument ${k}`);
	}
	if (!a.brands.length) a.brands = Object.keys(VENDORS);
	for (const b of a.brands) if (!VENDORS[b]) throw new Error(`Unknown brand ${b}`);
	return a;
}

/** GET one URL politely; a 429 stops with the Retry-After advice (no hammering). */
async function getText(url, { binary = false } = {}) {
	const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
	if (res.status === 429)
		throw new Error(
			`${url}: rate limited (Retry-After ${res.headers.get('retry-after')}); try again later`
		);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** Product pages of a vendor, from saved HTML (DIR/<key>.<handle>.html) or the store (spaced requests). */
async function loadPages(key, args) {
	const v = VENDORS[key];
	const pages = [];
	for (const cfg of v.pages ?? []) {
		let html;
		if (args.pagesDir) {
			try {
				html = await readFile(join(args.pagesDir, `${key}.${cfg.handle}.html`), 'utf8');
			} catch {
				console.error(`  missing saved page ${key}.${cfg.handle}.html`);
				continue;
			}
		} else {
			html = await getText(`${v.host}/products/${cfg.handle}`);
			await sleep(args.delay);
		}
		pages.push({ cfg, colors: parseProductPage(html) });
	}
	return pages;
}

/** Estimate hexes from product photos for colors the store gives no hex for (needs the optional sharp). */
async function sampleMissing(key, pages, args, hexOverrides) {
	const sharp = (await import('sharp')).default;
	for (const { cfg, colors } of pages) {
		for (const c of colors) {
			if (c.hex || !c.image) continue;
			const k = `${cfg.handle}|${c.name}`;
			if (hexOverrides[k]) continue;
			const file =
				args.imagesDir &&
				join(args.imagesDir, `${key}.${cfg.handle}.${c.name.replace(/\W+/g, '_')}.img`);
			let buf;
			try {
				if (file) buf = await readFile(file);
			} catch {
				// not cached
			}
			if (!buf) {
				buf = await getText(`${c.image}${c.image.includes('?') ? '&' : '?'}width=400`, {
					binary: true
				});
				if (file) await writeFile(file, buf);
				await sleep(3000);
			}
			hexOverrides[k] = { hex: await sampleImageHex(buf, sharp, cfg.box), hexSource: 'image' };
		}
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const out = resolve(args.out ?? OUT);
	const hexOverrides = args.overrides ? JSON.parse(await readFile(args.overrides, 'utf8')) : {};
	let existing = { brands: [] };
	try {
		existing = JSON.parse(await readFile(out, 'utf8'));
	} catch {
		// first run
	}
	const brands = [];
	for (const key of args.brands) {
		const skipped = [];
		let brand;
		let seen;
		if (args.pagesDir || args.fetchPages) {
			const pages = await loadPages(key, args);
			if (args.sample) await sampleMissing(key, pages, args, hexOverrides);
			brand = {
				name: VENDORS[key].name,
				sourceUrl: VENDORS[key].host,
				fetchedAt: new Date().toISOString(),
				materials: convertPages(pages, { hexOverrides, skipped })
			};
			seen = `${pages.length} pages`;
		} else {
			const products = args.dir
				? await readSaved(args.dir, key)
				: await fetchProducts(VENDORS[key].host, { delayMs: args.delay });
			brand = buildSupplementBrand(key, products, { hexOverrides, skipped });
			seen = `${products.length} products`;
		}
		brands.push(brand);
		const n = brand.materials.reduce((s, m) => s + m.colors.length, 0);
		console.log(`${brand.name}: ${seen} -> ${n} colors, ${skipped.length} skipped`);
		for (const s of skipped)
			console.error(`  skipped: ${s.product}${s.color ? ` / ${s.color}` : ''}: ${s.reason}`);
	}
	await writeFile(out, JSON.stringify(mergeBrands(existing, brands), null, '\t') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
