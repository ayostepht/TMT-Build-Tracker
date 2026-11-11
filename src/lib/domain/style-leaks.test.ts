import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard: global class names in src/app.css leak into every component, so a component <style> block
// must not declare a selector on one of them (`.row`, `.chip`, ...). Use a prefixed, component-
// specific name instead (CLAUDE.md "Conventions"). The test asserts the FINAL state: if it fails
// during a design-system wave, the listed files are components that are still being converted.
const LEAKED = [
	'row',
	'chip',
	'dot',
	'head',
	'bar',
	'tabs',
	'seg',
	'stack',
	'more',
	'brand',
	'group'
];

const root = fileURLToPath(new URL('../../../', import.meta.url));

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) return svelteFiles(p);
		return p.endsWith('.svelte') ? [p] : [];
	});
}

/** Offending selectors as `file:line  .name` for every component style block. */
function offenders(file: string): string[] {
	const text = readFileSync(file, 'utf8');
	const out: string[] = [];
	for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		const bodyStart = m.index! + m[0].indexOf('>') + 1;
		// Blank out comments and declaration bodies so only selectors remain (keeping line numbers).
		const css = m[1].replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
		let depth = 0;
		let selStart = 0;
		for (let i = 0; i <= css.length; i++) {
			const c = css[i];
			if (c === '{') {
				const sel = css.slice(selStart, i);
				// Selector text only (at-rule preludes such as @media are skipped).
				if (!sel.trim().startsWith('@')) {
					const clean = sel.replace(/:global\([^)]*\)/g, ' ');
					for (const cm of clean.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
						if (LEAKED.includes(cm[1])) {
							const at = bodyStart + selStart + sel.indexOf(cm[0]);
							const line = text.slice(0, at).split('\n').length;
							out.push(`${relative(root, file)}:${line}  .${cm[1]}`);
						}
					}
				}
				depth++;
				selStart = i + 1;
			} else if (c === '}') {
				depth--;
				selStart = i + 1;
			} else if (c === ';' && depth >= 0) {
				// declaration end inside a block or an at-rule statement: next selector starts here
				selStart = i + 1;
			}
		}
	}
	return out;
}

describe('component styles do not reuse leaked global class names', () => {
	it('no src/**/*.svelte <style> selector uses a name from the leak list', () => {
		const all = svelteFiles(join(root, 'src')).flatMap(offenders);
		expect(
			all,
			`rename these selectors (and their markup) to prefixed names:\n${all.join('\n')}`
		).toEqual([]);
	});
});
