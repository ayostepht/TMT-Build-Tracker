<script lang="ts" module>
	import { canPrintPieces } from '#lib/domain/index.ts';
	import type { BuildCtx } from './build-context.svelte.ts';

	/**
	 * Is "Print some pieces…" offered for this part right now? The viewer can edit, the build is a
	 * build (not a draft) and `canPrintPieces` says the part qualifies (two or more pieces to go, not on
	 * the printer, on a plate that prints once or on none). The menu entry of the status badge shows
	 * exactly when this is true.
	 */
	export function piecesOffered(ctx: BuildCtx, slug: string): boolean {
		return ctx.canEdit && ctx.view.build.kind === 'build' && canPrintPieces(ctx.view, slug);
	}
</script>

<script lang="ts">
	import { piecesLeft } from '#lib/domain/index.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import StartOnPrinter from './StartOnPrinter.svelte';
	import PartPickSheet, { type PickItem } from './PartPickSheet.svelte';
	import LogRunSheet from './LogRunSheet.svelte';

	/**
	 * "Print some pieces…" for one part that has several pieces (`PartDef.components`): the sheets behind
	 * the status badge's "Print some pieces…" menu entry (the parent shows the entry when `piecesOffered`
	 * says so and sets `picking`). The pick sheet opens (the part's unticked pieces, all ticked), then either marks those pieces
	 * printing (`ctx.startPieces`: the part is Printing with `printingComps`) or logs them as a run of
	 * pieces. With an enabled printer, "Mark as printing" first asks "Where is it printing?"
	 * (`StartOnPrinter` with `comps`: the printer's job is linked to this part and those pieces only);
	 * "Not on a connected printer" is the direct start. Ticking every piece still to print is the part's normal Printing action, which the
	 * parent knows how to run (`onwhole`: it may ask "Where is it printing?").
	 *
	 * Renders no button of its own, only the sheets (mounted for editors, they stay open while saving
	 * makes the part ineligible).
	 */
	let {
		slug,
		onwhole,
		picking = $bindable(false)
	}: {
		slug: string;
		/** Every piece still to print was picked: run the part's normal Printing action. */
		onwhole: () => void;
		/** Open the pick sheet (set by the parent's menu entry). */
		picking?: boolean;
	} = $props();

	const ctx = getBuildCtx();
	let logging = $state(false);
	let logComps = $state<number[]>([]);
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	let where = $state(false);
	let whereComps = $state<number[]>([]);

	const part = $derived(ctx.view.parts.find((p) => p.slug === slug));
	const left = $derived(piecesLeft(ctx.view, slug));
	const items = $derived<PickItem[]>(
		left.map((i) => ({
			id: String(i),
			name: part?.components[i]?.name ?? `Piece ${i + 1}`,
			hint: part?.components[i]?.settings
		}))
	);
	const plate = $derived(ctx.view.plates.find((p) => p.parts.includes(slug)) ?? null);
	const label = (k: number) =>
		`${k} of ${part?.components.length ?? k} pieces of ${part?.name ?? slug}`;
	// "3 of 9 pieces of Harness and Straps: Harness Right, Harness Left, Buckle Holder ×5" for the printer dialog.
	const piecesNote = (comps: number[]) =>
		`${label(comps.length)}: ${comps
			.map((i) => part?.components[i]?.name ?? `Piece ${i + 1}`)
			.join(', ')}`;

	function print(picked: string[]) {
		const comps = picked.map(Number);
		if (comps.length >= left.length) onwhole();
		else if (hasPrinter && plate) {
			whereComps = comps;
			where = true;
		} else void ctx.startPieces(slug, comps, label(comps.length));
	}
	function log(picked: string[]) {
		logComps = picked.map(Number);
		logging = true;
	}
</script>

<!-- The sheets stay mounted while open even if saving makes the part ineligible. -->
{#if ctx.canEdit && part}
	<PartPickSheet
		bind:open={picking}
		unit="piece"
		title="Print some pieces of {part.name}"
		{items}
		onprint={print}
		onlog={log}
	/>
	{#if plate}
		<StartOnPrinter
			bind:open={where}
			slugs={[slug]}
			plateNumber={plate.number}
			label={label(whereComps.length)}
			comps={whereComps}
			note={piecesNote(whereComps)}
			confirm={false}
		/>
	{/if}
	{#if logComps.length}
		<LogRunSheet
			bind:open={logging}
			quick
			plateNumber={plate?.number ?? null}
			slugs={[slug]}
			comps={logComps}
			title="Log a print: {label(logComps.length)}"
		/>
	{/if}
{/if}
