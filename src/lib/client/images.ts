/** Browser-side image helpers: downscale photos and re-encode them (this also drops EXIF/GPS). */

function canvasBlob(
	canvas: HTMLCanvasElement,
	type: string,
	quality: number
): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Encode a canvas as WebP (JPEG where the browser cannot), shrinking quality until it fits `maxBytes`. */
export async function encodeCanvas(
	canvas: HTMLCanvasElement,
	opts: { quality?: number; maxBytes?: number } = {}
): Promise<Blob> {
	let q = opts.quality ?? 0.82;
	let blob = await canvasBlob(canvas, 'image/webp', q);
	let type = 'image/webp';
	if (!blob || blob.type !== 'image/webp') {
		type = 'image/jpeg';
		blob = await canvasBlob(canvas, type, q);
	}
	while (blob && opts.maxBytes && blob.size > opts.maxBytes && q > 0.4) {
		q -= 0.12;
		blob = await canvasBlob(canvas, type, q);
	}
	if (!blob) throw new Error('This browser could not encode the image');
	return blob;
}

function drawn(src: CanvasImageSource, sw: number, sh: number, maxSide: number) {
	const scale = Math.min(1, maxSide / Math.max(sw, sh));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(sw * scale));
	canvas.height = Math.max(1, Math.round(sh * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('This browser cannot process images');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
	return canvas;
}

export interface ScaledPhoto {
	full: Blob;
	thumb: Blob;
	width: number;
	height: number;
}

/** Downscale a picked photo to at most 2000 px (WebP) plus a 400 px thumbnail. EXIF orientation is applied, all metadata dropped. */
export async function downscalePhoto(file: File | Blob): Promise<ScaledPhoto> {
	if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new Error('That image could not be read');
	}
	try {
		const big = drawn(bmp, bmp.width, bmp.height, 2000);
		const small = drawn(big, big.width, big.height, 400);
		const [full, thumb] = await Promise.all([
			encodeCanvas(big, { quality: 0.82, maxBytes: 7 * 1024 * 1024 }),
			encodeCanvas(small, { quality: 0.75 })
		]);
		return { full, thumb, width: big.width, height: big.height };
	} finally {
		bmp.close();
	}
}
