/**
 * Assembly checklist rules (pure). A template carries ordered steps; a build shows the ones
 * that fit its variant choices and stores progress per item key:
 * `<step>` (step done), `<step>:check:<checkKey>`, `<step>:hw:<hardware name>`.
 */
import type { AssemblyItem, AssemblyStep, BuildView, PartDef } from './types.ts';

/** Section labels by step key prefix (`frame.side` → "Frame"). */
export const ASSEMBLY_SECTIONS: Record<string, string> = {
	frame: 'Frame',
	wheels: 'Wheels',
	seat: 'Seat',
	extras: 'Accessories',
	finish: 'Straps and safety'
};

/** The last step; its checks are the handoff safety checklist. */
export const SAFETY_STEP_KEY = 'finish.safety';

export const checkItemKey = (step: string, check: string) => `${step}:check:${check}`;
export const hwItemKey = (step: string, name: string) => `${step}:hw:${name}`;

export function sectionOfStepKey(key: string): string {
	const prefix = key.split('.')[0] ?? '';
	return ASSEMBLY_SECTIONS[prefix] ?? 'Other';
}

/** A step row as stored for the template. */
export interface StepRow {
	key: string;
	title: string;
	description: string;
	guidePage: number | null;
	parts: string[];
	hardware: { name: string; qty?: number }[];
	checks: { key: string; text: string }[];
	when: { group: string; option: string } | null;
}

/** Steps that apply to a build: `when` must match the chosen option; parts are limited to active ones. */
export function filterSteps(
	rows: StepRow[],
	choices: Record<string, string>,
	activeSlugs: Set<string>
): AssemblyStep[] {
	const out: AssemblyStep[] = [];
	for (const r of rows) {
		if (r.when && choices[r.when.group] !== r.when.option) continue;
		const parts = r.parts.filter((s) => activeSlugs.has(s));
		if (r.parts.length > 0 && parts.length === 0) continue;
		out.push({
			key: r.key,
			section: sectionOfStepKey(r.key),
			title: r.title,
			description: r.description,
			guidePage: r.guidePage,
			parts,
			hardware: r.hardware,
			checks: r.checks,
			safety: r.key === SAFETY_STEP_KEY
		});
	}
	return out;
}

type AssemblyLike = Pick<BuildView, 'assembly' | 'parts' | 'state'>;

export const isDone = (view: Pick<BuildView, 'assembly'>, itemKey: string): boolean =>
	view.assembly.items[itemKey]?.done === true;

export function itemOf(
	view: Pick<BuildView, 'assembly'>,
	itemKey: string
): AssemblyItem | undefined {
	return view.assembly.items[itemKey];
}

export interface StepProgress {
	done: boolean;
	checksDone: number;
	checksTotal: number;
	hardwareDone: number;
	hardwareTotal: number;
}

export function stepProgress(view: Pick<BuildView, 'assembly'>, step: AssemblyStep): StepProgress {
	return {
		done: isDone(view, step.key),
		checksDone: step.checks.filter((c) => isDone(view, checkItemKey(step.key, c.key))).length,
		checksTotal: step.checks.length,
		hardwareDone: step.hardware.filter((h) => isDone(view, hwItemKey(step.key, h.name))).length,
		hardwareTotal: step.hardware.length
	};
}

export interface AssemblyProgress {
	total: number;
	done: number;
	percent: number;
}

export function assemblyProgress(view: Pick<BuildView, 'assembly'>): AssemblyProgress {
	const total = view.assembly.steps.length;
	const done = view.assembly.steps.filter((s) => isDone(view, s.key)).length;
	return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Active parts that are not printed yet (the build cannot be fully assembled until this is empty). */
export function unprintedParts(view: Pick<BuildView, 'parts' | 'state'>): PartDef[] {
	return view.parts.filter((p) => view.state[p.slug]?.status !== 'Printed');
}

export function readyToAssemble(view: Pick<BuildView, 'parts' | 'state'>): {
	ready: boolean;
	printed: number;
	total: number;
	missing: PartDef[];
} {
	const missing = unprintedParts(view);
	return {
		ready: missing.length === 0 && view.parts.length > 0,
		printed: view.parts.length - missing.length,
		total: view.parts.length,
		missing
	};
}

/** The safety step's checks, all ticked. False when the build has no safety step. */
export function safetyComplete(view: Pick<BuildView, 'assembly'>): boolean {
	const s = view.assembly.steps.find((x) => x.safety);
	return (
		!!s && s.checks.length > 0 && s.checks.every((c) => isDone(view, checkItemKey(s.key, c.key)))
	);
}

export function assemblyComplete(view: AssemblyLike): boolean {
	const p = assemblyProgress(view);
	return p.total > 0 && p.done === p.total;
}

/** Which item an itemKey names, or null when it is not part of the build's steps. */
export function resolveItem(
	steps: AssemblyStep[],
	itemKey: string
): { step: AssemblyStep; kind: 'step' | 'check' | 'hw'; text: string } | null {
	const [stepKey, kind, rest] = itemKey.split(':');
	const step = steps.find((s) => s.key === stepKey);
	if (!step) return null;
	if (kind === undefined) return { step, kind: 'step', text: step.title };
	if (kind === 'check' && rest !== undefined && itemKey === `${stepKey}:check:${rest}`) {
		const c = step.checks.find((x) => x.key === rest);
		return c ? { step, kind: 'check', text: c.text } : null;
	}
	if (kind === 'hw') {
		const name = itemKey.slice(stepKey.length + 4);
		const h = step.hardware.find((x) => x.name === name);
		return h ? { step, kind: 'hw', text: h.name } : null;
	}
	return null;
}
