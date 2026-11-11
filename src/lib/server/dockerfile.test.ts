import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the Dockerfile against COPY sources that no longer exist in the repo (a deleted
// script once broke `docker build` unnoticed on machines without Docker).

const root = resolve(__dirname, '../../..');

/** Local (non --from) COPY/ADD sources, with line continuations joined. */
export function localCopySources(dockerfile: string): { line: string; src: string }[] {
	const joined = dockerfile.replace(/\\\r?\n/g, ' ');
	const out: { line: string; src: string }[] = [];
	for (const line of joined.split(/\r?\n/)) {
		const m = /^\s*(?:COPY|ADD)\s+(.*)$/i.exec(line);
		if (!m) continue;
		const parts = m[1].trim().split(/\s+/);
		const flags = parts.filter((p) => p.startsWith('--'));
		if (flags.some((f) => f.startsWith('--from='))) continue;
		const args = parts.filter((p) => !p.startsWith('--'));
		for (const src of args.slice(0, -1)) out.push({ line: line.trim(), src });
	}
	return out;
}

function exists(src: string): boolean {
	const rel = src.replace(/^\.?\//, '').replace(/^\/+/, '');
	if (rel === '' || rel === '.') return true;
	// Build output and installed deps only exist after `npm run build` / `npm ci`.
	if (/^(build|node_modules)(\/|$)/.test(rel)) return true;
	if (/[*?[]/.test(rel)) {
		const dir = resolve(root, rel.slice(0, rel.lastIndexOf('/') + 1));
		const re = new RegExp(
			'^' +
				rel
					.slice(rel.lastIndexOf('/') + 1)
					.replace(/[.+^${}()|\\]/g, '\\$&')
					.replace(/\*/g, '.*')
					.replace(/\?/g, '.') +
				'$'
		);
		return existsSync(dir) && readdirSync(dir).some((f) => re.test(f));
	}
	return existsSync(resolve(root, rel));
}

describe('Dockerfile COPY sources', () => {
	const text = readFileSync(process.env.DOCKERFILE_PATH ?? resolve(root, 'Dockerfile'), 'utf8');
	const sources = localCopySources(text);

	it('finds COPY lines', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every local source path exists in the repo', () => {
		const missing = sources.filter((s) => !exists(s.src)).map((s) => s.src);
		expect(missing).toEqual([]);
	});

	it('paths from --from stages (builder /app/scripts/...) exist in the repo too', () => {
		const fromScripts = [
			...text.replace(/\\\r?\n/g, ' ').matchAll(/\/app\/(scripts\/[^\s]+|drizzle|package\.json)/g)
		].map((m) => m[1]);
		const missing = fromScripts.filter((p) => !existsSync(resolve(root, p)));
		expect(missing).toEqual([]);
	});
});
