import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWriteRate, takeWriteToken, writeRateConfig, writeRateResponse } from './write-rate';

const u = { id: 'u1', email: 'u1@example.test', emailVerified: false };

beforeEach(() => {
	resetWriteRate();
	vi.stubEnv('TMT_MODE', 'public');
	vi.stubEnv('PUBLIC_URL', 'https://example.test');
});
afterEach(() => vi.unstubAllEnvs());

describe('write rate limit', () => {
	it('is off in selfhost and on in public mode', () => {
		vi.stubEnv('TMT_MODE', 'selfhost');
		expect(writeRateConfig()).toBeNull();
		expect(writeRateResponse(u, 'POST', '/api/builds', () => false)).toBeNull();
		vi.stubEnv('TMT_MODE', 'public');
		expect(writeRateConfig()).toEqual({ perMin: 120, burst: 60 });
		vi.stubEnv('WRITE_RATE_PER_MIN', 'off');
		expect(writeRateConfig()).toBeNull();
	});

	it('allows the burst, then answers 429 with code rate and Retry-After', async () => {
		const now = 1_000_000;
		let refused: Response | null = null;
		for (let i = 0; i < 61 && !refused; i++)
			refused = writeRateResponse(u, 'PATCH', '/api/builds/x', () => false, now);
		expect(refused?.status).toBe(429);
		expect(Number(refused!.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
		expect(await refused!.json()).toMatchObject({ code: 'rate' });
	});

	it('refills over time and keys by user', () => {
		const cfg = { perMin: 120, burst: 2 };
		expect(takeWriteToken('a', cfg, 0)).toBe(0);
		expect(takeWriteToken('a', cfg, 0)).toBe(0);
		expect(takeWriteToken('a', cfg, 0)).toBeGreaterThan(0);
		expect(takeWriteToken('b', cfg, 0)).toBe(0);
		expect(takeWriteToken('a', cfg, 600)).toBe(0); // 2/s refill
	});

	it('ignores reads, auth routes and anonymous requests', () => {
		vi.stubEnv('WRITE_RATE_BURST', '1');
		for (let i = 0; i < 5; i++) {
			expect(writeRateResponse(u, 'GET', '/api/builds', () => false, 0)).toBeNull();
			expect(writeRateResponse(u, 'POST', '/api/auth/sign-in', () => false, 0)).toBeNull();
			expect(writeRateResponse(null, 'POST', '/api/builds', () => false, 0)).toBeNull();
		}
	});

	it('limits form actions outside /api/ and shapes the refusal per caller', async () => {
		vi.stubEnv('WRITE_RATE_BURST', '1');
		const path = '/teams/x/members';
		expect(writeRateResponse(u, 'POST', path, () => false, 0)).toBeNull();
		const plain = writeRateResponse(
			u,
			'POST',
			path,
			() => false,
			0,
			new Headers({ accept: 'text/html' })
		);
		expect(plain?.status).toBe(429);
		expect(plain!.headers.get('content-type')).toContain('text/html');
		expect(await plain!.text()).toContain('Too many changes');
		const enh = writeRateResponse(
			u,
			'POST',
			path,
			() => false,
			0,
			new Headers({ 'x-sveltekit-action': 'true' })
		);
		const body = await enh!.json();
		expect(body).toMatchObject({ type: 'failure', status: 429 });
		expect(JSON.parse(body.data)).toEqual([{ error: 1, code: 2 }, expect.any(String), 'rate']);
		const json = writeRateResponse(u, 'POST', path, () => false, 0, new Headers());
		expect(await json!.json()).toMatchObject({ code: 'rate' });
	});

	it('exempts site admins', () => {
		vi.stubEnv('WRITE_RATE_BURST', '1');
		for (let i = 0; i < 10; i++)
			expect(writeRateResponse(u, 'POST', '/api/builds', () => true, 0)).toBeNull();
	});
});
