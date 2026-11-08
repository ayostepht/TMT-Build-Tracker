/**
 * Incremental parser for `multipart/x-mixed-replace` MJPEG streams: push network chunks, get
 * whole JPEG frames. Handles boundaries that already include dashes (`boundary=--frame`), parts
 * with and without Content-Length (then SOI/EOI scanning) and chunks split anywhere.
 */

export const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;

/** The boundary token from a `multipart/*; boundary=...` content type, or null. */
export function boundaryOf(contentType: string | null): string | null {
	if (!contentType) return null;
	const m = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
	const b = m?.[1] ?? m?.[2];
	return b ? b : null;
}

/** A copy of `b` cut right after its last JPEG EOI, or null when it is not a JPEG. */
export function cleanJpeg(b: Uint8Array): Buffer | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	const buf = Buffer.from(b.buffer, b.byteOffset, b.length);
	const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
	return end < 2 ? null : Buffer.from(buf.subarray(0, end + 2));
}

type Mode = 'seek' | 'headers' | 'body';

export class MjpegParser {
	private buf: Buffer = Buffer.alloc(0);
	private mode: Mode = 'seek';
	private length: number | null = null;
	private readonly delim: Buffer;
	/** Set when a frame exceeded the cap or the stream is garbage. */
	error: string | null = null;

	constructor(
		boundary: string,
		private maxFrame = MAX_FRAME_BYTES
	) {
		// `--foo` and `foo` both mean the same delimiter line in the body: `--foo`.
		this.delim = Buffer.from('--' + boundary.replace(/^-+/, ''));
	}

	push(chunk: Uint8Array): Buffer[] {
		const frames: Buffer[] = [];
		if (this.error) return frames;
		this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
		for (;;) {
			if (this.mode === 'seek') {
				const i = this.buf.indexOf(this.delim);
				if (i < 0) {
					// keep a tail that could be the start of a delimiter
					this.buf = this.buf.subarray(Math.max(0, this.buf.length - this.delim.length));
					break;
				}
				this.buf = this.buf.subarray(i + this.delim.length);
				this.mode = 'headers';
				this.length = null;
			}
			if (this.mode === 'headers') {
				// A part starts after the delimiter line: `\r\n` + headers + blank line.
				// A final delimiter `--foo--` has no headers; it ends the stream.
				const sep = findHeaderEnd(this.buf);
				if (!sep) {
					if (this.buf.length > MAX_HEADER_BYTES) return this.fail('Camera sent bad headers');
					break;
				}
				const head = this.buf.subarray(0, sep.at).toString('latin1');
				const cl = /content-length\s*:\s*(\d+)/i.exec(head);
				this.length = cl ? Number(cl[1]) : null;
				if (this.length !== null && this.length > this.maxFrame)
					return this.fail('Camera frame too large');
				this.buf = this.buf.subarray(sep.at + sep.len);
				this.mode = 'body';
			}
			if (this.mode === 'body') {
				const frame = this.takeBody();
				if (frame === 'wait') break;
				if (frame) frames.push(frame);
				if (this.error) break;
			}
		}
		return frames;
	}

	private fail(msg: string): Buffer[] {
		this.error = msg;
		this.buf = Buffer.alloc(0);
		return [];
	}

	/** Extract one frame from the buffer start; `'wait'` when more data is needed. */
	private takeBody(): Buffer | null | 'wait' {
		const b = this.buf;
		if (this.length !== null) {
			if (b.length < this.length) return 'wait';
			const f = Buffer.from(b.subarray(0, this.length));
			this.buf = b.subarray(this.length);
			this.mode = 'seek';
			return cleanJpeg(f);
		}
		// No Content-Length: the frame runs up to the next delimiter, or (when the chunk ends
		// right after a JPEG EOI) up to the buffer end so a slow camera is not a frame behind.
		if (b.length > this.maxFrame + this.delim.length + 8) {
			this.fail('Camera frame too large');
			return null;
		}
		const next = b.indexOf(this.delim);
		if (next >= 0) {
			const f = trimTail(b.subarray(0, next), true);
			this.buf = b.subarray(next); // delimiter stays for the seek step
			this.mode = 'seek';
			return cleanJpeg(f);
		}
		if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
			const t = trimTail(b, false);
			if (t.length > 4 && t[t.length - 2] === 0xff && t[t.length - 1] === 0xd9) {
				this.buf = Buffer.alloc(0);
				this.mode = 'seek';
				return Buffer.from(t);
			}
		}
		return 'wait';
	}
}

function findHeaderEnd(b: Buffer): { at: number; len: number } | null {
	// Skip the rest of the delimiter line first (it ends the line with CRLF or LF).
	const crlf = b.indexOf('\r\n\r\n');
	const lf = b.indexOf('\n\n');
	// The first line break belongs to the delimiter line, so a blank line directly after
	// it (no headers at all) shows up as `\r\n\r\n` at index 0 or `\n\n`.
	if (crlf >= 0 && (lf < 0 || crlf < lf)) return { at: crlf, len: 4 };
	if (lf >= 0) return { at: lf, len: 2 };
	return null;
}

function trimTail(b: Buffer, dashes: boolean): Buffer {
	const ws = (x: number) => x === 0x0d || x === 0x0a;
	let end = b.length;
	while (end > 0 && ws(b[end - 1])) end--;
	// a delimiter written with extra dashes leaves `--` in front of the match
	if (dashes && end >= 2 && b[end - 1] === 0x2d && b[end - 2] === 0x2d) end -= 2;
	while (end > 0 && ws(b[end - 1])) end--;
	return b.subarray(0, end);
}
