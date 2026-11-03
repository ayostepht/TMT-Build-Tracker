import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateModelPath } from '../config.ts';
import type { ConvertResult } from './convert-core.ts';
import type { MatchPart } from './match.ts';

export interface ConvertTemplate {
	id: string;
	parts: MatchPart[];
}

export type { ConvertResult };

/** Hard stop for a runaway conversion. */
const TIMEOUT_MS = 20 * 60 * 1000;

function workerEntry(): { file: string; execArgv: string[] } {
	const heap = '--max-old-space-size=768';
	const built = join(process.cwd(), 'build', 'worker', 'convert-worker.js');
	if (existsSync(built)) return { file: built, execArgv: [heap] };
	// Dev / tests: run the TypeScript source directly (Node 22 strips the types).
	return {
		file: join(dirname(fileURLToPath(import.meta.url)), 'worker.ts'),
		execArgv: [heap, '--experimental-strip-types', '--no-warnings']
	};
}

/**
 * Converts an uploaded STEP zip into the template's GLB (`templateModelPath`) in a
 * child process with a capped heap, so a big file can never take the web server down.
 * The GLB is written atomically (temp file + rename) by the worker.
 */
export function convertStepZip(
	zipPath: string,
	template: ConvertTemplate,
	onProgress: (pct: number, message: string) => void
): Promise<ConvertResult> {
	const { file, execArgv } = workerEntry();
	return new Promise((resolve, reject) => {
		const child = fork(file, [], {
			execArgv,
			serialization: 'json',
			stdio: ['ignore', 'inherit', 'inherit', 'ipc']
		});
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			finish(() => reject(new Error('The conversion took too long and was stopped')));
		}, TIMEOUT_MS);
		child.on(
			'message',
			(m: { type: string; pct?: number; message?: string; result?: ConvertResult }) => {
				if (m.type === 'progress') onProgress(m.pct ?? 0, m.message ?? '');
				else if (m.type === 'done' && m.result) finish(() => resolve(m.result!));
				else if (m.type === 'error')
					finish(() => reject(new Error(m.message || 'Conversion failed')));
			}
		);
		child.on('error', (e) => finish(() => reject(e)));
		child.on('close', (code, signal) =>
			finish(() =>
				reject(
					new Error(
						signal === 'SIGKILL' || code === 134
							? 'The converter ran out of memory'
							: `The converter stopped unexpectedly (${signal ?? 'exit ' + code})`
					)
				)
			)
		);
		child.send({
			type: 'start',
			zipPath,
			outPath: templateModelPath(template.id),
			parts: template.parts
		});
	});
}
