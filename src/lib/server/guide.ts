import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { ApiError } from './access';
import { uploadsDir } from './config';
import type { Db } from './db';
import { templateGuidePages } from './db/schema';
import { extensionOf, sniffImage, stripImageMetadata, type ImageType } from './images';

export const MAX_GUIDE_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_PDF_PAGE = 2000;

const guideDir = (templateId: string) => join(uploadsDir(), 'guide', templateId);

/** Relative (to the uploads dir) path of an uploaded PDF page image. */
const relPath = (templateId: string, pdfPage: number, type: ImageType) =>
	`guide/${templateId}/${pdfPage}.${extensionOf(type)}`;

function absolute(rel: string): string {
	const root = resolve(uploadsDir());
	const p = resolve(root, rel);
	if (!p.startsWith(root + sep)) throw new ApiError(404, 'Not found');
	return p;
}

function parsePage(n: unknown): number {
	const v = typeof n === 'string' ? Number(n) : n;
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_PDF_PAGE)
		throw new ApiError(400, 'Page number must be a whole number from 1 to 2000');
	return v;
}

/** Existing upload slots: PDF page number → stored file name. */
async function uploadedFiles(templateId: string): Promise<Map<number, string>> {
	const out = new Map<number, string>();
	try {
		for (const f of await readdir(guideDir(templateId))) {
			const m = /^(\d+)\.(webp|jpg|png)$/.exec(f);
			if (m) out.set(Number(m[1]), f);
		}
	} catch {
		/* nothing uploaded yet */
	}
	return out;
}

/** Store one rendered PDF page (site admin). Image only (JPEG, PNG or WebP), at most 3 MB. */
export async function saveGuidePage(
	templateId: string,
	n: unknown,
	bytes: Uint8Array
): Promise<{ pdfPage: number; size: number }> {
	const pdfPage = parsePage(n);
	if (bytes.length === 0) throw new ApiError(400, 'The page image is empty');
	if (bytes.length > MAX_GUIDE_PAGE_BYTES)
		throw new ApiError(413, 'The page image is larger than 3 MB');
	const type = sniffImage(bytes);
	if (!type) throw new ApiError(400, 'The page must be a JPEG, PNG or WebP image');
	const clean = stripImageMetadata(bytes, type);
	await mkdir(guideDir(templateId), { recursive: true });
	await rm(join(guideDir(templateId), `${pdfPage}.webp`), { force: true });
	await rm(join(guideDir(templateId), `${pdfPage}.jpg`), { force: true });
	await rm(join(guideDir(templateId), `${pdfPage}.png`), { force: true });
	await writeFile(absolute(relPath(templateId, pdfPage, type)), clean);
	return { pdfPage, size: clean.length };
}

export interface GuideStatus {
	/** PDF page numbers that have an uploaded image. */
	uploaded: number[];
	/** Our guide pages and the PDF page each one shows (null = no image). */
	pages: { page: number; title: string; pdfPage: number | null }[];
}

export async function guideStatus(db: Db, templateId: string): Promise<GuideStatus> {
	const uploaded = [...(await uploadedFiles(templateId)).keys()].sort((a, b) => a - b);
	const pages = db
		.select()
		.from(templateGuidePages)
		.where(eq(templateGuidePages.templateId, templateId))
		.orderBy(asc(templateGuidePages.sort))
		.all()
		.map((g) => {
			const m = g.imagePath ? /\/(\d+)\.(?:webp|jpg|png)$/.exec(g.imagePath) : null;
			return { page: g.page, title: g.title, pdfPage: m ? Number(m[1]) : null };
		});
	return { uploaded, pages };
}

/**
 * Point guide pages at uploaded images: `{ "<our page>": <pdf page> | null }`. Unknown guide pages and
 * pdf pages that were never uploaded are rejected; null clears the image. Returns how many pages changed.
 */
export async function setGuideMapping(db: Db, templateId: string, map: unknown): Promise<number> {
	if (typeof map !== 'object' || map === null || Array.isArray(map))
		throw new ApiError(400, 'map must be an object of page numbers');
	const files = await uploadedFiles(templateId);
	const known = new Set(
		db
			.select({ page: templateGuidePages.page })
			.from(templateGuidePages)
			.where(eq(templateGuidePages.templateId, templateId))
			.all()
			.map((g) => g.page)
	);
	const plan: [number, string | null][] = [];
	for (const [k, v] of Object.entries(map)) {
		const page = Number(k);
		if (!Number.isInteger(page) || !known.has(page))
			throw new ApiError(400, `Unknown guide page ${k}`);
		if (v === null) {
			plan.push([page, null]);
			continue;
		}
		const pdfPage = parsePage(v);
		const file = files.get(pdfPage);
		if (!file) throw new ApiError(400, `PDF page ${pdfPage} has not been uploaded`);
		plan.push([page, `guide/${templateId}/${file}`]);
	}
	db.transaction((tx) => {
		for (const [page, imagePath] of plan)
			tx.update(templateGuidePages)
				.set({ imagePath })
				.where(
					and(eq(templateGuidePages.templateId, templateId), eq(templateGuidePages.page, page))
				)
				.run();
	});
	return plan.length;
}

/** Forget every imported guide image (files and mappings). */
export async function clearGuide(db: Db, templateId: string): Promise<void> {
	db.update(templateGuidePages)
		.set({ imagePath: null })
		.where(eq(templateGuidePages.templateId, templateId))
		.run();
	await rm(guideDir(templateId), { recursive: true, force: true });
}

export interface GuideFile {
	bytes: Uint8Array;
	type: ImageType;
	etag: string;
}

async function readFileInfo(rel: string): Promise<GuideFile> {
	try {
		const p = absolute(rel);
		const [bytes, st] = await Promise.all([readFile(p), stat(p)]);
		const u8 = new Uint8Array(bytes);
		return {
			bytes: u8,
			type: sniffImage(u8) ?? 'image/webp',
			etag: `"${st.size}-${Math.round(st.mtimeMs)}"`
		};
	} catch {
		throw new ApiError(404, 'Not found');
	}
}

/** The image of one of our guide pages (any signed-in user). */
export async function readGuidePage(db: Db, templateId: string, page: number): Promise<GuideFile> {
	const row = db
		.select({ imagePath: templateGuidePages.imagePath })
		.from(templateGuidePages)
		.where(and(eq(templateGuidePages.templateId, templateId), eq(templateGuidePages.page, page)))
		.get();
	if (!row?.imagePath) throw new ApiError(404, 'Not found');
	return readFileInfo(row.imagePath);
}

/** An uploaded PDF page image, for the admin's mapping preview. */
export async function readUploadedPdfPage(templateId: string, n: unknown): Promise<GuideFile> {
	const pdfPage = parsePage(n);
	const file = (await uploadedFiles(templateId)).get(pdfPage);
	if (!file) throw new ApiError(404, 'Not found');
	return readFileInfo(`guide/${templateId}/${file}`);
}
