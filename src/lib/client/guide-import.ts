/**
 * Guide import in the browser: find the guide PDF (a PDF itself, or inside a MakeGood 3MF under
 * `Auxiliaries/`), render its pages with pdf.js and hand each page to the caller as an image.
 * Nothing here is bundled with the app that could contain guide content; the PDF is the admin's own file.
 */
import { unzipSync } from 'fflate';
import { encodeCanvas } from './images.ts';

/** Raw PDF bytes from a `.pdf`, or from the first PDF under `Auxiliaries/` in a 3MF/zip. */
export async function pdfBytesFromFile(file: File): Promise<{ bytes: Uint8Array; name: string }> {
	const buf = new Uint8Array(await file.arrayBuffer());
	if (isPdf(buf)) return { bytes: buf, name: file.name };
	if (buf[0] === 0x50 && buf[1] === 0x4b) {
		const files = unzipSync(buf, {
			filter: (f) => /\.pdf$/i.test(f.name) && /(^|\/)Auxiliaries\//i.test(f.name)
		});
		for (const [name, data] of Object.entries(files)) if (isPdf(data)) return { bytes: data, name };
		throw new Error('No PDF found inside that file (looked under Auxiliaries/)');
	}
	throw new Error('Choose the guide PDF or a 3MF that contains it');
}

function isPdf(b: Uint8Array): boolean {
	return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}

export interface RenderedPage {
	page: number;
	total: number;
	blob: Blob;
}

/** Render every page at about `width` px wide (default 1600), one at a time. */
export async function renderPdfPages(
	bytes: Uint8Array,
	onPage: (p: RenderedPage) => Promise<void> | void,
	opts: { width?: number; isCancelled?: () => boolean } = {}
): Promise<number> {
	const pdfjs = await import('pdfjs-dist');
	const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
	pdfjs.GlobalWorkerOptions.workerSrc = worker;
	const task = pdfjs.getDocument({ data: bytes.slice() });
	const pdf = await task.promise;
	try {
		const target = opts.width ?? 1600;
		for (let n = 1; n <= pdf.numPages; n++) {
			if (opts.isCancelled?.()) break;
			const page = await pdf.getPage(n);
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: target / base.width });
			const canvas = document.createElement('canvas');
			canvas.width = Math.round(viewport.width);
			canvas.height = Math.round(viewport.height);
			await page.render({ canvas, viewport }).promise;
			const blob = await encodeCanvas(canvas, { quality: 0.82, maxBytes: 2.8 * 1024 * 1024 });
			page.cleanup();
			await onPage({ page: n, total: pdf.numPages, blob });
		}
		return pdf.numPages;
	} finally {
		await task.destroy();
	}
}
