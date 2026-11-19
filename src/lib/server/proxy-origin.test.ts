import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// scripts/proxy-origin.mjs runs before adapter-node reads its env. adapter-node 6.0.2+
// throws on an empty ORIGIN and honours a non-empty one, so the preload normalises it.
function originAfterPreload(env: Record<string, string>): string {
	const out = execFileSync(
		process.execPath,
		[
			'--import',
			'./scripts/proxy-origin.mjs',
			'-e',
			'console.log(JSON.stringify(process.env.ORIGIN ?? null))'
		],
		{
			env: { PATH: process.env.PATH ?? '', ...env },
			encoding: 'utf8'
		}
	);
	return JSON.parse(out.trim());
}

describe('proxy-origin preload: ORIGIN', () => {
	it('drops an empty or blank ORIGIN', () => {
		expect(originAfterPreload({ ORIGIN: '' })).toBeNull();
		expect(originAfterPreload({ ORIGIN: '  ' })).toBeNull();
		expect(originAfterPreload({})).toBeNull();
	});

	it('mirrors the forced origin into ORIGIN, PUBLIC_URL first', () => {
		expect(originAfterPreload({ PUBLIC_URL: 'https://tmt.example.com/' })).toBe(
			'https://tmt.example.com'
		);
		expect(
			originAfterPreload({ PUBLIC_URL: 'https://a.example.com', ORIGIN: 'https://b.example.com' })
		).toBe('https://a.example.com');
		expect(originAfterPreload({ PUBLIC_URL: '  ', BETTER_AUTH_URL: 'https://x.example' })).toBe(
			'https://x.example'
		);
		expect(originAfterPreload({ ORIGIN: 'http://192.0.2.1:3000' })).toBe('http://192.0.2.1:3000');
	});
});
