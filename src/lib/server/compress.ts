import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/** Below this a compressed body saves nothing worth the CPU. */
const MIN_BYTES = 1024;
const COMPRESSIBLE = /^(text\/html|application\/json)\b/i;

/**
 * gzip for the dynamic responses (pages and JSON) when the browser accepts it. adapter-node only serves
 * precompressed static files, and most installs are opened straight by LAN or Tailscale address with no
 * reverse proxy to compress for them: a build page is ~90 kB of HTML and the swatch catalog ~60 kB of
 * JSON, which is seconds on a phone's mobile connection. Streams (SSE, GLB downloads) are never touched.
 */
export async function compressResponse(request: Request, res: Response): Promise<Response> {
	if (
		request.method !== 'GET' ||
		res.status !== 200 ||
		!res.body ||
		res.headers.has('content-encoding') ||
		!/\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '') ||
		!COMPRESSIBLE.test(res.headers.get('content-type') ?? '') ||
		/no-transform/i.test(res.headers.get('cache-control') ?? '')
	)
		return res;
	const raw = Buffer.from(await res.arrayBuffer());
	const headers = new Headers(res.headers);
	headers.delete('content-length');
	if (raw.length < MIN_BYTES) {
		headers.set('content-length', String(raw.length));
		return new Response(raw, { status: res.status, statusText: res.statusText, headers });
	}
	const body = await gzipAsync(raw, { level: 6 });
	headers.set('content-encoding', 'gzip');
	headers.set('content-length', String(body.length));
	headers.append('vary', 'Accept-Encoding');
	return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** gzip'd bytes of a file for `gzipFile`, kept while the file is unchanged (a model is ~1 MB). */
const fileCache = new Map<string, Buffer>();

/**
 * A GLB (or any big static download) for a browser that accepts gzip: compressed once per file version and
 * kept in memory. Meshopt-packed models still shrink by a third, which matters on a phone's mobile
 * connection. `x-file-size` carries the real size so the viewer's progress bar stays right (three.js
 * prefers it to Content-Length). Returns null when the client does not take gzip: stream the file then.
 */
export async function gzipFile(
	request: Request,
	path: string,
	size: number,
	mtimeMs: number,
	read: () => Promise<Buffer>
): Promise<Buffer | null> {
	if (!/\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '')) return null;
	const key = `${path}:${size}:${mtimeMs}`;
	let hit = fileCache.get(key);
	if (!hit) {
		hit = await gzipAsync(await read(), { level: 9 });
		for (const k of fileCache.keys()) if (k.startsWith(`${path}:`)) fileCache.delete(k);
		if (fileCache.size >= 6) fileCache.delete(fileCache.keys().next().value!);
		fileCache.set(key, hit);
	}
	return hit;
}
