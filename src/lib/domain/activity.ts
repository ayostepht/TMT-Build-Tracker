import { fmt, fmtHM, fmtSpools } from './format.ts';
import { filamentLabel } from './labels.ts';
import type { ActivityItem, BuildView } from './types.ts';

type Names = Pick<BuildView, 'parts' | 'filaments' | 'members' | 'runs'> &
	Partial<Pick<BuildView, 'variantGroups'>>;
type Obj = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** " and set Handle Left back to To print" for the `recomputed` payload of run edits and deletes. */
function recomputedText(v: unknown, part: (slug: unknown) => string): string {
	if (!Array.isArray(v)) return '';
	const items = v
		.filter((x): x is Obj => typeof x === 'object' && x !== null && typeof x.to === 'string')
		.map((x) => `${part(x.slug)} ${x.to === 'To print' ? 'back to ' : 'to '}${x.to as string}`);
	return items.length ? ` and set ${list(items)}` : '';
}

/**
 * One human sentence for an activity row, using part / filament names from the
 * view rather than slugs. Kinds are the ones written by the server
 * (src/lib/server/builds/actions.ts and create.ts); unknown kinds fall back to a
 * generic line so old or future rows never break the list.
 */
export function describeActivity(a: ActivityItem, view: Names): string {
	const p: Obj = a.payload ?? {};
	const who = a.userName ?? (typeof p.by === 'string' && p.by ? p.by : 'Someone');
	const part = (slug: unknown) => view.parts.find((x) => x.slug === slug)?.name ?? 'a part';
	const parts = (slugs: unknown) =>
		Array.isArray(slugs) && slugs.length ? list(slugs.map((s) => part(s))) : 'some parts';
	const fil = (role: unknown) => {
		const f = view.filaments.find((x) => x.key === role);
		return f ? filamentLabel(f) : (str(role) ?? 'a filament');
	};

	switch (a.kind) {
		case 'build.create':
			return `${who} started this build`;
		case 'build.update': {
			const bits: string[] = [];
			if ('name' in p) bits.push(`renamed it to "${str(p.name) ?? ''}"`);
			if ('phase' in p) bits.push(`moved it to the ${str(p.phase) ?? ''} phase`);
			if ('recipient' in p) bits.push(p.recipient ? `set the recipient` : `cleared the recipient`);
			if ('hospital' in p) bits.push(p.hospital ? `set the hospital` : `cleared the hospital`);
			if ('deliveryDate' in p)
				bits.push(
					p.deliveryDate
						? `set the delivery date to ${str(p.deliveryDate)}`
						: `cleared the delivery date`
				);
			return bits.length ? `${who} ${list(bits)}` : `${who} edited the build details`;
		}
		case 'build.move':
			return str(p.toName)
				? `${who} moved this build to ${str(p.toName)}`
				: `${who} moved this build to a chapter`;
		case 'build.variant': {
			const g = view.variantGroups?.find((x) => x.key === p.group);
			const o = g?.options.find((x) => x.key === p.to);
			const gName = g?.name ?? str(p.groupName) ?? 'an option';
			const oName = o?.name ?? str(p.toName) ?? 'another option';
			return `${who} switched ${gName} to ${oName}`;
		}
		case 'part.status': {
			const to = str(p.to);
			return to
				? `${who} set ${part(p.slug)} to ${to}`
				: `${who} changed the status of ${part(p.slug)}`;
		}
		case 'part.update': {
			const bits: string[] = [];
			if (p.comps) bits.push('ticked off components');
			if ('assigneeUserId' in p) {
				const m = view.members.find((x) => x.userId === p.assigneeUserId);
				bits.push(m ? `assigned it to ${m.name}` : 'cleared the assignee');
			}
			return `${who} updated ${part(p.slug)}${bits.length ? ` (${list(bits)})` : ''}`;
		}
		case 'printing.start':
			return `${who} put ${parts(p.slugs)} on the printer`;
		case 'printing.stop':
			return `${who} took ${parts(p.slugs)} off the printer`;
		case 'printing.setStart':
			return `${who} changed the print start time for ${parts(p.slugs)}`;
		case 'printing.setEstimate': {
			const s = num(p.seconds);
			return s === null
				? `${who} cleared the time estimate for ${parts(p.slugs)}`
				: `${who} set the time estimate for ${parts(p.slugs)} to ${fmtHM(s)}`;
		}
		case 'run.add':
		case 'run.update':
		case 'run.delete':
		case 'run.undo': {
			const result = (str(p.result) ?? 'print').toLowerCase();
			const adj = result === 'success' ? 'successful' : result === 'failed' ? 'failed' : result;
			const plate = num(p.plateNumber);
			const target =
				plate !== null
					? `plate ${plate}`
					: Array.isArray(p.partSlugs) && p.partSlugs.length
						? parts(p.partSlugs)
						: p.partSlug
							? part(p.partSlug)
							: 'a part';
			if (a.kind === 'run.undo') return `${who} undid a ${adj} print of ${target}`;
			if (a.kind === 'run.update') {
				const bits: string[] = [];
				if ('result' in p) bits.push(`the result to ${(str(p.result) ?? 'unknown').toLowerCase()}`);
				if ('date' in p) bits.push(`the date to ${str(p.date) ?? 'unknown'}`);
				if ('newPartSlug' in p) bits.push(`the part to ${part(p.newPartSlug)}`);
				if ('grams' in p) bits.push('the grams');
				if ('hours' in p) bits.push('the hours');
				if ('note' in p) bits.push('the note');
				return `${who} edited a print log of ${target}${bits.length ? ` (changed ${list(bits)})` : ''}${recomputedText(p.recomputed, part)}`;
			}
			if (a.kind === 'run.delete')
				return `${who} deleted a ${adj} print of ${target} from the log${recomputedText(p.recomputed, part)}`;
			let grams = num(p.grams);
			if (grams === null) grams = view.runs.find((r) => r.id === p.runId)?.grams ?? null;
			return `${who} logged a ${adj} print of ${target}${grams !== null ? ` (${fmt(grams)} g)` : ''}`;
		}
		case 'plate.slicer': {
			const n = num(p.number);
			const label = n !== null ? `plate ${n}` : 'a plate';
			const g = num(p.slicerGrams);
			if (g !== null) return `${who} set the slicer weight of ${label} to ${fmt(g)} g`;
			if (p.slicerGrams === null) return `${who} cleared the slicer weight of ${label}`;
			return `${who} updated the slicer weights of ${label}`;
		}
		case 'plates.layout': {
			const n = num(p.convertedRuns) ?? 0;
			return `${who} switched the plates to MakeGood's ${str(p.name) ?? 'selected'} profile (${num(p.plates) ?? 0} plates)${n ? ` and converted ${n} print log${n === 1 ? '' : 's'} to part logs` : ''}`;
		}
		case 'build.printer': {
			const n = str(p.name);
			return n
				? `${who} set the printer to ${n} (${num(p.bedX) ?? '?'}×${num(p.bedY) ?? '?'} mm bed)`
				: `${who} cleared the printer`;
		}
		case 'plates.arrange': {
			const n = num(p.convertedRuns) ?? 0;
			return `${who} arranged the plates for ${str(p.printer) ?? 'the printer'} (${num(p.plates) ?? 0} plates)${n ? ` and converted ${n} print log${n === 1 ? '' : 's'} to part logs` : ''}`;
		}
		case 'plates.upload': {
			const n = num(p.convertedRuns) ?? 0;
			return `${who} organized the plates from ${str(p.fileName) ?? 'an uploaded 3MF'} (${num(p.plates) ?? 0} plates)${n ? ` and converted ${n} print log${n === 1 ? '' : 's'} to part logs` : ''}`;
		}
		case 'printer.job.start': {
			const pr = str(p.printer) ?? 'the printer';
			const plate = num(p.plateNumber);
			return plate !== null
				? `${pr} started printing plate ${plate}${str(p.fileName) ? ` (${str(p.fileName)})` : ''}`
				: `${pr} started printing ${str(p.fileName) ?? 'a file'}`;
		}
		case 'printer.job.done': {
			const pr = str(p.printer) ?? 'The printer';
			const plate = num(p.plateNumber);
			const target = plate !== null ? `plate ${plate}` : (str(p.fileName) ?? 'a print');
			const g = num(p.grams);
			return p.auto
				? `${pr} finished ${target}; the print was logged automatically${g !== null ? ` (${fmt(g)} g)` : ''}`
				: `${pr} finished ${target}`;
		}
		case 'printer.job.link': {
			const plate = num(p.plateNumber);
			return `${who} linked ${str(p.printer) ?? 'a printer'}'s print to ${plate !== null ? `plate ${plate}` : 'a plate'}`;
		}
		case 'filament.spool': {
			return p.spoolId == null
				? `${who} unlinked the Spoolman spool from ${fil(p.role)}`
				: `${who} linked ${fil(p.role)} to Spoolman spool #${num(p.spoolId)}${str(p.spoolName) ? ` (${str(p.spoolName)})` : ''}`;
		}
		case 'filament.spools': {
			const s = num(p.spools);
			return s === null
				? `${who} updated spools for ${fil(p.role)}`
				: `${who} set ${fil(p.role)} spools to ${fmtSpools(s)}`;
		}
		case 'filament.update': {
			const bits: string[] = [];
			if (str(p.name)) bits.push(`renamed it to "${str(p.name)}"`);
			if (str(p.material)) bits.push(`set the material to ${str(p.material)}`);
			if (str(p.hex)) bits.push(`changed the color to ${str(p.hex)}`);
			if (num(p.spools) !== null) bits.push(`set spools to ${fmtSpools(num(p.spools) as number)}`);
			return `${who} updated ${fil(p.role)}${bits.length ? `: ${list(bits)}` : ''}`;
		}
		case 'design.update': {
			const bits: string[] = [];
			if (Array.isArray(p.moves)) {
				// "moved Wing Left and Wing Right to Overture Blue", one clause per target color.
				const byRole = new Map<string, { to: string; names: string[] }>();
				for (const m of p.moves as Obj[]) {
					const to = str(m.roleName) ?? fil(m.role);
					const key = str(m.role) ?? to;
					const e = byRole.get(key) ?? { to, names: [] };
					e.names.push(str(m.name) ?? part(m.slug));
					byRole.set(key, e);
				}
				for (const e of byRole.values()) bits.push(`moved ${list(e.names)} to ${e.to}`);
			}
			const added = (p.added ?? null) as Obj | null;
			if (added) bits.push(`added a color: ${str(added.name) ?? 'new color'}`);
			const removed = (p.removed ?? null) as Obj | null;
			if (removed) bits.push(`removed a color: ${str(removed.name) ?? 'a color'}`);
			return bits.length ? `${who} ${list(bits)}` : `${who} changed the colors`;
		}
		case 'design.apply':
			return str(p.designName)
				? `${who} applied the color design "${str(p.designName)}"`
				: `${who} applied a color design`;
		case 'build.import': {
			const bits = [
				num(p.parts) !== null ? `${fmt(num(p.parts) as number)} parts` : null,
				num(p.runs) !== null ? `${fmt(num(p.runs) as number)} prints` : null
			].filter((x): x is string => !!x);
			const what = `progress from the original prototype${bits.length ? ` (${list(bits)})` : ''}${p.replaced ? ', replacing what was there' : ''}`;
			return a.userId === null && !a.userName
				? `An administrator imported ${what}`
				: `${who} imported ${what}`;
		}
		case 'assembly.item': {
			const step = str(p.step) ?? 'a step';
			const text = str(p.text) ?? step;
			const kind = str(p.item) ?? 'step';
			const note = str(p.note);
			const parts: string[] = [];
			if (typeof p.done === 'boolean') {
				if (kind === 'step')
					parts.push(p.done ? `marked step "${step}" done` : `reopened step "${step}"`);
				else if (kind === 'check')
					parts.push(p.done ? `ticked "${text}" in "${step}"` : `unticked "${text}" in "${step}"`);
				else
					parts.push(
						p.done ? `checked off ${text} in "${step}"` : `unchecked ${text} in "${step}"`
					);
			}
			if (note)
				parts.push(
					note === 'cleared' ? `removed a note on "${step}"` : `added a note on "${step}"`
				);
			return `${who} ${parts.length ? list(parts) : `changed "${step}"`}`;
		}
		case 'handoff.update': {
			const fields = Array.isArray(p.fields) ? p.fields.filter((f) => typeof f === 'string') : [];
			return fields.length === 1 && fields[0] === 'safetyChecked'
				? `${who} updated the safety sign-off`
				: `${who} updated the handoff details`;
		}
		case 'build.handoff':
			return str(p.organization)
				? `${who} marked the chair as handed off to ${str(p.organization)}`
				: `${who} marked the chair as handed off`;
		case 'photo.add':
			return `${who} added a ${photoKind(p.photoKind)} photo`;
		case 'photo.delete':
			return `${who} removed a ${photoKind(p.photoKind)} photo`;
		default:
			return `${who} made a change (${a.kind})`;
	}
}

function photoKind(v: unknown): string {
	return v === 'finished' ? 'finished-chair' : v === 'handoff' ? 'handoff' : 'progress';
}
