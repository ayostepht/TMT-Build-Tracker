/**
 * Minimal image sniffing and metadata stripping for uploads (no image library on the server).
 * Browsers re-encode photos through a canvas, which already drops EXIF/GPS; this is the server-side
 * backstop for clients that skip that step. Only JPEG, PNG and WebP are accepted.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImage(b: Uint8Array): ImageType | null {
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (
		b.length >= 8 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47 &&
		b[4] === 0x0d &&
		b[5] === 0x0a &&
		b[6] === 0x1a &&
		b[7] === 0x0a
	)
		return 'image/png';
	if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
	return null;
}

export const extensionOf = (t: ImageType): string =>
	t === 'image/jpeg' ? 'jpg' : t === 'image/png' ? 'png' : 'webp';

function ascii(b: Uint8Array, at: number, n: number): string {
	let s = '';
	for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i] ?? 0);
	return s;
}

const u32be = (b: Uint8Array, at: number) =>
	((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) =>
	(b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** Removes EXIF, XMP, IPTC and text metadata; returns the bytes unchanged for a malformed file. */
export function stripImageMetadata(b: Uint8Array, type: ImageType): Uint8Array {
	try {
		if (type === 'image/jpeg') return stripJpeg(b);
		if (type === 'image/png') return stripPng(b);
		return stripWebp(b);
	} catch {
		return b;
	}
}

function stripJpeg(b: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [b.subarray(0, 2)];
	let i = 2;
	while (i + 4 <= b.length) {
		if (b[i] !== 0xff) return b;
		const marker = b[i + 1];
		if (marker === 0xda) {
			// start of scan: the rest is entropy-coded data
			parts.push(b.subarray(i));
			return concat(parts);
		}
		const len = (b[i + 2] << 8) | b[i + 3];
		if (len < 2 || i + 2 + len > b.length) return b;
		const seg = b.subarray(i, i + 2 + len);
		// APP1 (EXIF/XMP), APP2 (ICC is kept), APP13 (IPTC), COM (comment)
		const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
		if (!drop) parts.push(seg);
		i += 2 + len;
	}
	return b;
}

function stripPng(b: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [b.subarray(0, 8)];
	let i = 8;
	const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
	while (i + 12 <= b.length) {
		const len = u32be(b, i);
		const type = ascii(b, i + 4, 4);
		const end = i + 12 + len;
		if (end > b.length) return b;
		if (!drop.has(type)) parts.push(b.subarray(i, end));
		i = end;
		if (type === 'IEND') break;
	}
	return concat(parts);
}

function stripWebp(b: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [];
	let i = 12;
	while (i + 8 <= b.length) {
		const type = ascii(b, i, 4);
		const len = u32le(b, i + 4);
		const end = i + 8 + len + (len & 1);
		if (end > b.length + 1) return b;
		let chunk = b.subarray(i, Math.min(end, b.length));
		if (type === 'EXIF' || type === 'XMP ') {
			i = end;
			continue;
		}
		if (type === 'VP8X') {
			chunk = chunk.slice();
			chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
		}
		parts.push(chunk);
		i = end;
	}
	const body = concat(parts);
	const out = new Uint8Array(12 + body.length);
	out.set(b.subarray(0, 12));
	out.set(body, 12);
	const size = out.length - 8;
	out[4] = size & 255;
	out[5] = (size >> 8) & 255;
	out[6] = (size >> 16) & 255;
	out[7] = (size >> 24) & 255;
	return out;
}
