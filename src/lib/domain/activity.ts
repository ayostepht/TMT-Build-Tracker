import { fmt, fmtHM } from './format.ts';
import { filamentLabel } from './labels.ts';
import type { ActivityItem, BuildView } from './types.ts';

type Names = Pick<BuildView, 'parts' | 'filaments' | 'members' | 'runs'>;
type Obj = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * One human sentence for an activity row, using part / filament names from the
 * view rather than slugs. Kinds are the ones written by the server
 * (src/lib/server/builds/actions.ts and create.ts); unknown kinds fall back to a
 * generic line so old or future rows never break the list.
 */
export function describeActivity(a: ActivityItem, view: Names): string {
	const who = a.userName ?? 'Someone';
	const p: Obj = a.payload ?? {};
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
		case 'run.delete': {
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
			if (a.kind === 'run.delete') return `${who} deleted a ${adj} print of ${target} from the log`;
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
		case 'filament.spools': {
			const s = num(p.spools);
			return s === null
				? `${who} updated spools for ${fil(p.role)}`
				: `${who} set ${fil(p.role)} spools to ${fmt(s)}`;
		}
		case 'filament.update': {
			const bits: string[] = [];
			if (str(p.name)) bits.push(`renamed it to "${str(p.name)}"`);
			if (str(p.material)) bits.push(`set the material to ${str(p.material)}`);
			if (str(p.hex)) bits.push(`changed the color to ${str(p.hex)}`);
			if (num(p.spools) !== null) bits.push(`set spools to ${fmt(num(p.spools) as number)}`);
			return `${who} updated ${fil(p.role)}${bits.length ? `: ${list(bits)}` : ''}`;
		}
		default:
			return `${who} made a change (${a.kind})`;
	}
}
