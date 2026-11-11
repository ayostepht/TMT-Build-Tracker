/**
 * Opt-in probe against a real Elegoo printer: if its camera answers "not ready", send SDCP
 * Cmd 386 {Enable:1} (the only command the app may send) and grab one frame.
 *   TMT_REAL_ELEGOO=<your printer's address> TMT_REAL_OUT=data/shots-camera/real-frame-enabled.jpg npx vitest run camera.real-enable
 * Skipped unless TMT_REAL_ELEGOO is set. At most 3 attempts, 5 s apart; never loops on failure.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enableSdcpCamera } from './adapters/sdcp';
import { grabFrame } from './camera';

const host = process.env.TMT_REAL_ELEGOO;
const out = process.env.TMT_REAL_OUT ?? 'data/shots-camera/real-frame-enabled.jpg';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(): Promise<{ status: number; body: string }> {
	const c = new AbortController();
	const t = setTimeout(() => c.abort(), 5000);
	try {
		const r = await fetch(`http://${host}:3031/video`, { signal: c.signal });
		const body = r.ok ? '' : (await r.text()).slice(0, 80);
		if (r.ok) await r.body?.cancel();
		return { status: r.status, body };
	} finally {
		clearTimeout(t);
		c.abort();
	}
}

describe.skipIf(!host)('real Elegoo camera enable', () => {
	it('not ready -> Cmd 386 -> one frame', { timeout: 60_000 }, async () => {
		const before = await probe();
		console.log('REAL before:', before.status, JSON.stringify(before.body));
		let sent = false;
		if (before.status !== 200 && /not ready/i.test(before.body)) {
			for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
				sent = await enableSdcpCamera({
					id: 'real',
					kind: 'elegoo-sdcp',
					host: host!,
					port: 3030,
					secrets: {}
				});
				console.log(
					'REAL enable attempt',
					attempt,
					sent ? 'sent' : 'not sent (refused/unreachable)'
				);
				if (!sent && attempt < 3) await sleep(5000);
			}
			for (let i = 0; i < 5; i++) {
				if ((await probe()).status === 200) break;
				await sleep(1000);
			}
			console.log('REAL after:', (await probe()).status);
		}
		console.log('REAL command sent:', sent);
		const jpg = await grabFrame(
			{ urls: [`http://${host}:3031/video`], origin: 'default', host: host! },
			{ connectTimeoutMs: 5000, stallTimeoutMs: 8000 }
		);
		writeFileSync(out, jpg);
		console.log('REAL frame bytes', jpg.length, 'saved to', out);
		expect(jpg[0]).toBe(0xff);
	});
});
