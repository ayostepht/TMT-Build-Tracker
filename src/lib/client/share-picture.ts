/**
 * "Share a picture" (issue #99), browser side: draws the finished picture on a 2D canvas from the
 * chair snapshot, the two typed strings and the swatches; encodes it; hands it to the share sheet or
 * the download. Nothing leaves the device. The rules (sizes, texts, swatches, contrast, text fitting,
 * file names) are in `domain/share-picture.ts`. The picture always has the same look, whatever the
 * app theme: it is an export, not UI.
 */
import {
	JPEG_QUALITY,
	SOCIAL_SIZES,
	VARIANTS,
	drawnSections,
	fitSections,
	headingSize,
	pictureDims,
	cleanText,
	contrastRatio,
	fitText,
	mimeOf,
	pictureFileName,
	socialPalette,
	type PictureFormat,
	type FittedSections,
	type PictureVariant,
	type SocialSize,
	type TextSection
} from '#lib/domain/share-picture.ts';

export interface PictureInput {
	variant: PictureVariant;
	/** Social layout only. */
	size: SocialSize;
	/** Social layout, Portrait and Story only (`drawnSections` picks what is drawn). */
	sections: TextSection[];
	title: string;
	line: string;
	/** Distinct chair colors, most used first (`swatchColors`). */
	swatches: string[];
	/** Transparent PNG of the chair (`ModelStage.snapshot({ clean: true })`). */
	chair: Blob;
}

const DISPLAY = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const BODY = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The faces the canvas uses; loaded before drawing (canvas text does not wait for web fonts). */
async function loadFonts(): Promise<void> {
	if (typeof document === 'undefined' || !document.fonts) return;
	try {
		await Promise.all([
			document.fonts.load('700 100px "Barlow Condensed"', 'Aa'),
			document.fonts.load('500 40px "IBM Plex Sans"', 'Aa'),
			document.fonts.load('400 40px "IBM Plex Sans"', 'Aa')
		]);
	} catch {
		/* the fallback stack draws instead */
	}
}

// ---- the chair image ----------------------------------------------------------------------

interface Cropped {
	img: CanvasImageSource;
	w: number;
	h: number;
}

/** Load the snapshot and cut away the empty border, so the chair can be centered and scaled to fit. */
async function trimmedChair(blob: Blob): Promise<Cropped> {
	const bmp = await createImageBitmap(blob);
	const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
	const sw = Math.max(1, Math.round(bmp.width * scale));
	const sh = Math.max(1, Math.round(bmp.height * scale));
	const probe = document.createElement('canvas');
	probe.width = sw;
	probe.height = sh;
	const pc = probe.getContext('2d', { willReadFrequently: true })!;
	pc.drawImage(bmp, 0, 0, sw, sh);
	const data = pc.getImageData(0, 0, sw, sh).data;
	let x0 = sw,
		y0 = sh,
		x1 = -1,
		y1 = -1;
	for (let y = 0; y < sh; y++)
		for (let x = 0; x < sw; x++)
			if (data[(y * sw + x) * 4 + 3] > 10) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
	if (x1 < 0) return { img: bmp, w: bmp.width, h: bmp.height }; // empty: keep as is
	const pad = 2; // probe pixels
	const inv = 1 / scale;
	const x = Math.max(0, Math.floor((x0 - pad) * inv));
	const y = Math.max(0, Math.floor((y0 - pad) * inv));
	const w = Math.min(bmp.width - x, Math.ceil((x1 - x0 + 1 + pad * 2) * inv));
	const h = Math.min(bmp.height - y, Math.ceil((y1 - y0 + 1 + pad * 2) * inv));
	const out = document.createElement('canvas');
	out.width = w;
	out.height = h;
	out.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
	bmp.close();
	return { img: out, w, h };
}

// ---- drawing helpers ----------------------------------------------------------------------

function rrect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	const rr = Math.min(r, w / 2, h / 2);
	c.beginPath();
	c.moveTo(x + rr, y);
	c.arcTo(x + w, y, x + w, y + h, rr);
	c.arcTo(x + w, y + h, x, y + h, rr);
	c.arcTo(x, y + h, x, y, rr);
	c.arcTo(x, y, x + w, y, rr);
	c.closePath();
}

function measurer(c: CanvasRenderingContext2D, weight: number, family: string) {
	return (t: string, size: number) => {
		c.font = `${weight} ${size}px ${family}`;
		return c.measureText(t).width;
	};
}

interface TextBlock {
	lines: string[];
	size: number;
	lineHeight: number;
	height: number;
}

function layoutText(
	c: CanvasRenderingContext2D,
	text: string,
	weight: number,
	family: string,
	sizes: number[],
	maxWidth: number,
	lh: number,
	maxLines = 2
): TextBlock {
	const measure = measurer(c, weight, family);
	// A headline reads best on one line: take it when it fits at 80% of the largest size or more.
	const oneLine =
		maxLines > 1
			? fitText(text, measure, {
					sizes: sizes.filter((s) => s >= sizes[0] * 0.8),
					maxWidth,
					maxLines: 1
				})
			: null;
	const f =
		oneLine && !oneLine.truncated ? oneLine : fitText(text, measure, { sizes, maxWidth, maxLines });
	const lineHeight = Math.round(f.size * lh);
	return { lines: f.lines, size: f.size, lineHeight, height: f.lines.length * lineHeight };
}

function drawText(
	c: CanvasRenderingContext2D,
	b: TextBlock,
	weight: number,
	family: string,
	color: string,
	x: number,
	top: number,
	align: CanvasTextAlign
) {
	c.font = `${weight} ${b.size}px ${family}`;
	c.fillStyle = color;
	c.textAlign = align;
	c.textBaseline = 'alphabetic';
	// Baseline of the first line: centered in its line box (ascent ~ 0.8 em).
	b.lines.forEach((l, i) =>
		c.fillText(l, x, top + i * b.lineHeight + b.size * 0.86 + (b.lineHeight - b.size) / 2)
	);
}

function drawChair(
	c: CanvasRenderingContext2D,
	chair: Cropped,
	box: { x: number; y: number; w: number; h: number },
	shadow: boolean
) {
	const s = Math.min(box.w / chair.w, box.h / chair.h);
	const w = chair.w * s;
	const h = chair.h * s;
	const x = box.x + (box.w - w) / 2;
	const y = box.y + (box.h - h) / 2;
	if (shadow) {
		// Soft contact shadow under the wheels.
		c.save();
		const cx = x + w / 2;
		const cy = y + h - h * 0.015;
		c.translate(cx, cy);
		c.scale(1, 0.1);
		const g = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
		g.addColorStop(0, 'rgba(20,24,40,0.28)');
		g.addColorStop(1, 'rgba(20,24,40,0)');
		c.fillStyle = g;
		c.beginPath();
		c.arc(0, 0, w * 0.5, 0, Math.PI * 2);
		c.fill();
		c.restore();
	}
	c.imageSmoothingQuality = 'high';
	c.drawImage(chair.img, x, y, w, h);
}

function drawSwatches(
	c: CanvasRenderingContext2D,
	colors: string[],
	cx: number,
	cy: number,
	d: number,
	gap: number,
	ring: string,
	edge: string
) {
	const total = colors.length * d + (colors.length - 1) * gap;
	let x = cx - total / 2 + d / 2;
	for (const hex of colors) {
		c.beginPath();
		c.arc(x, cy, d / 2 + d * 0.05, 0, Math.PI * 2);
		c.fillStyle = ring;
		c.fill();
		c.lineWidth = Math.max(1.5, d * 0.015);
		c.strokeStyle = edge;
		c.stroke();
		c.beginPath();
		c.arc(x, cy, d / 2, 0, Math.PI * 2);
		c.fillStyle = hex;
		c.fill();
		// A hairline keeps white and pale colors visible on a light card.
		c.lineWidth = Math.max(1, d * 0.012);
		c.strokeStyle = 'rgba(20,24,40,0.28)';
		c.stroke();
		x += d + gap;
	}
}

// ---- the two layouts ----------------------------------------------------------------------

function drawFamily(c: CanvasRenderingContext2D, chair: Cropped, i: PictureInput) {
	const spec = VARIANTS.family;
	const W = spec.width;
	const H = spec.height;
	const m = 130;
	const inner = W - m * 2;
	const title = cleanText(i.title, spec.titleMax);
	const line = cleanText(i.line, spec.lineMax);

	const bg = c.createLinearGradient(0, 0, 0, H);
	bg.addColorStop(0, '#fbf9f5');
	bg.addColorStop(1, '#f2eee6');
	c.fillStyle = bg;
	c.fillRect(0, 0, W, H);

	let y = 150;
	const tb = layoutText(c, title, 700, DISPLAY, [156, 136, 116, 96], inner, 1.02);
	if (tb.lines.length) {
		drawText(c, tb, 700, DISPLAY, '#1e2230', W / 2, y, 'center');
		y += tb.height + 30;
		c.fillStyle = '#c9c2b4';
		rrect(c, W / 2 - 50, y, 100, 8, 4);
		c.fill();
		y += 8;
	}

	// Bottom up: credit, line, swatches; the chair takes what is left in between.
	const creditSize = 32;
	const creditY = H - 110;
	let bottom = creditY - 70;
	const lb = line ? layoutText(c, line, 400, BODY, [46, 42, 38], inner, 1.35) : null;
	if (lb) {
		bottom -= lb.height;
		drawText(c, lb, 400, BODY, '#4a5164', W / 2, bottom, 'center');
		bottom -= 60;
	}
	const n = i.swatches.length;
	const d = n > 4 ? 140 : 164;
	if (n) {
		const cy = bottom - d / 2;
		drawSwatches(c, i.swatches, W / 2, cy, d, 38, '#ffffff', '#e3ddd0');
		bottom = cy - d / 2 - 70;
	}

	const top = y + 60;
	// Card behind the chair: soft white with a light shadow.
	const card = { x: m, y: top, w: inner, h: Math.max(200, bottom - top) };
	c.save();
	c.shadowColor = 'rgba(40,36,24,0.14)';
	c.shadowBlur = 50;
	c.shadowOffsetY = 18;
	c.fillStyle = '#ffffff';
	rrect(c, card.x, card.y, card.w, card.h, 56);
	c.fill();
	c.restore();
	drawChair(c, chair, { x: card.x + 40, y: card.y + 50, w: card.w - 80, h: card.h - 100 }, true);

	c.font = `500 ${creditSize}px ${BODY}`;
	c.fillStyle = '#5b6276';
	c.textAlign = 'center';
	c.textBaseline = 'alphabetic';
	c.fillText(spec.credit, W / 2, creditY + creditSize);
}

function drawSocial(c: CanvasRenderingContext2D, chair: Cropped, i: PictureInput) {
	const spec = VARIANTS.social;
	const size = SOCIAL_SIZES[i.size];
	const W = size.width;
	const H = size.height;
	const m = 64;
	const inner = W - m * 2;
	const pal = socialPalette(i.swatches);
	const title = cleanText(i.title, spec.titleMax);
	const line = cleanText(i.line, spec.lineMax);
	const sections = drawnSections(i.sections, i.size);

	// The background fills the whole frame; text and swatches stay inside the safe bands.
	c.fillStyle = pal.bg;
	c.fillRect(0, 0, W, H);

	let y = size.safeTop;
	const tb = layoutText(c, title, 700, DISPLAY, [120, 108, 96, 84, 72], inner, 0.98);
	if (tb.lines.length) {
		c.fillStyle = pal.accent;
		rrect(c, m, y, 96, 10, 5);
		c.fill();
		y += 30;
		drawText(c, tb, 700, DISPLAY, pal.text, m, y, 'left');
		y += tb.height;
	}
	if (line) {
		const lb = layoutText(c, line, 500, BODY, [38, 34, 30], inner, 1.3);
		y += 14;
		drawText(c, lb, 500, BODY, pal.muted, m, y, 'left');
		y += lb.height;
	}

	const creditSize = 22;
	const creditBase = H - size.safeBottom;
	const panelTop = y + 28;
	const bottomEdge = creditBase - creditSize - 22;
	let panelBottom = bottomEdge;
	let fit: FittedSections | null = null;
	const gap = 34;
	if (sections.length) {
		const measure = (t: string, sz: number, kind: 'heading' | 'body') => {
			c.font = `${kind === 'heading' ? 600 : 400} ${sz}px ${BODY}`;
			return c.measureText(t).width;
		};
		// The chair panel keeps its minimum; the text takes the rest and shrinks or is cut to fit.
		const room = bottomEdge - panelTop - size.minPanel - gap;
		fit = fitSections(sections, measure, {
			maxWidth: inner,
			maxHeight: Math.max(0, room),
			sizes: [34, 31, 28, 26, 24],
			gap: 28
		});
		panelBottom = Math.max(panelTop + 240, bottomEdge - fit.height - gap);
	}
	const panel = { x: m, y: panelTop, w: inner, h: panelBottom - panelTop };
	c.fillStyle = pal.panel;
	rrect(c, panel.x, panel.y, panel.w, panel.h, 44);
	c.fill();

	const n = i.swatches.length;
	const d = 46;
	const swatchBand = n ? d + 40 : 0;
	drawChair(
		c,
		chair,
		{ x: panel.x + 36, y: panel.y + 28, w: panel.w - 72, h: panel.h - 56 - swatchBand },
		true
	);
	if (n)
		drawSwatches(
			c,
			i.swatches,
			panel.x + panel.w / 2,
			panel.y + panel.h - 24 - d / 2,
			d,
			16,
			'#ffffff',
			'#d9dce4'
		);

	if (fit) {
		const hs = headingSize(fit.size);
		const hLh = Math.round(hs * fit.lineHeight);
		const bLh = Math.round(fit.size * fit.lineHeight);
		let ty = panelBottom + gap;
		c.textAlign = 'left';
		c.textBaseline = 'alphabetic';
		fit.blocks.forEach((b, k) => {
			if (k) ty += 28;
			for (const l of b.headingLines) {
				c.font = `600 ${hs}px ${BODY}`;
				c.fillStyle = pal.text;
				c.fillText(l, m, ty + hs * 0.86 + (hLh - hs) / 2);
				ty += hLh;
			}
			for (const l of b.bodyLines) {
				c.font = `400 ${fit!.size}px ${BODY}`;
				c.fillStyle = pal.muted;
				c.fillText(l, m, ty + fit!.size * 0.86 + (bLh - fit!.size) / 2);
				ty += bLh;
			}
		});
	}

	// Credit, one line, shrunk to fit.
	const cb = layoutText(c, spec.credit, 500, BODY, [22, 20, 18], inner, 1, 1);
	c.font = `500 ${cb.size}px ${BODY}`;
	c.fillStyle = contrastRatio(pal.muted, pal.bg) >= 4.5 ? pal.muted : pal.text;
	c.textAlign = 'center';
	c.textBaseline = 'alphabetic';
	c.fillText(cb.lines[0] ?? spec.credit, W / 2, creditBase);
}

// ---- public API ---------------------------------------------------------------------------

/** Draw the picture on a new canvas of the layout's size. */
export async function composePicture(input: PictureInput): Promise<HTMLCanvasElement> {
	const spec = pictureDims(input.variant, input.size);
	const [chair] = await Promise.all([trimmedChair(input.chair), loadFonts()]);
	const canvas = document.createElement('canvas');
	canvas.width = spec.width;
	canvas.height = spec.height;
	const c = canvas.getContext('2d');
	if (!c) throw new Error('This browser cannot draw the picture');
	if (input.variant === 'family') drawFamily(c, chair, input);
	else drawSocial(c, chair, input);
	return canvas;
}

/** PNG or JPEG (quality 0.92; the layouts always fill their background, so JPEG has no transparency to lose). */
export function encodePicture(canvas: HTMLCanvasElement, format: PictureFormat): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('Could not create the image'))),
			mimeOf(format),
			format === 'jpeg' ? JPEG_QUALITY : undefined
		)
	);
}

export function pictureFile(
	blob: Blob,
	variant: PictureVariant,
	format: PictureFormat,
	size: SocialSize = 'square'
): File {
	return new File([blob], pictureFileName(variant, format, size), { type: mimeOf(format) });
}

/** True when the system share sheet accepts an image file here (hide the Share button otherwise). */
export function canShareImages(): boolean {
	try {
		if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
		if (typeof navigator.canShare !== 'function') return false;
		return navigator.canShare({
			files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })]
		});
	} catch {
		return false;
	}
}

/** Open the share sheet. Resolves false when the person closed it without sharing. */
export async function sharePicture(file: File): Promise<boolean> {
	try {
		await navigator.share({ files: [file] });
		return true;
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return false;
		throw e;
	}
}

/** Save the file through a temporary link. */
export function downloadPicture(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
