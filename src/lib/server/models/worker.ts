/**
 * Child-process entry of the STEP converter. Bundled to build/worker/convert-worker.js
 * (vite.worker.config.ts) and forked by convert.ts with a capped heap.
 * Protocol: parent sends one `{ type: 'start', ... }`; the child answers with
 * `progress` messages, then `done` or `error`, and exits.
 */
import { convertStepZipToGlb } from './convert-core.ts';
import type { MatchPart } from './match.ts';

interface StartMessage {
	type: 'start';
	zipPath: string;
	outPath: string;
	parts: MatchPart[];
}

process.on('message', async (msg: StartMessage) => {
	if (msg?.type !== 'start') return;
	try {
		const result = await convertStepZipToGlb({
			zipPath: msg.zipPath,
			outPath: msg.outPath,
			parts: msg.parts,
			onProgress: (pct, message) => process.send?.({ type: 'progress', pct, message })
		});
		process.send?.({ type: 'done', result }, () => process.exit(0));
	} catch (e) {
		process.send?.({ type: 'error', message: e instanceof Error ? e.message : String(e) }, () =>
			process.exit(1)
		);
	}
});
