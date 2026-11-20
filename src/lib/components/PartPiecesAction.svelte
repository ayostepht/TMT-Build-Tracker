<script lang="ts">
	import { canPrintPieces, piecesLeft } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import PartPickSheet, { type PickItem } from './PartPickSheet.svelte';
	import LogRunSheet from './LogRunSheet.svelte';

	/**
	 * "Print some pieces…" for one part that has several pieces (`PartDef.components`): a button that
	 * opens the pick sheet (the part's unticked pieces, all ticked), then either marks those pieces
	 * printing (`ctx.startPieces`: the part is Printing with `printingComps`) or logs them as a run of
	 * pieces. Ticking every piece still to print is the part's normal Printing action, which the
	 * parent knows how to run (`onwhole`: it may ask "Where is it printing?").
	 *
	 * Renders nothing unless the viewer can edit and `canPrintPieces` says the part qualifies (two or
	 * more pieces to go, not on the printer, on a plate that prints once or on none).
	 */
	let {
		slug,
		onwhole,
		cls = 'pill-link',
		testid = 'part-print-some'
	}: {
		slug: string;
		/** Every piece still to print was picked: run the part's normal Printing action. */
		onwhole: () => void;
		/** Classes of the button (`pill-link` in a part row, `btn sm ghost plc-text` in a plate control). */
		cls?: string;
		testid?: string;
	} = $props();

	const ctx = getBuildCtx();
	let picking = $state(false);
	let logging = $state(false);
	let logComps = $state<number[]>([]);

	const part = $derived(ctx.view.parts.find((p) => p.slug === slug));
	const eligible = $derived(
		ctx.canEdit && ctx.view.build.kind === 'build' && canPrintPieces(ctx.view, slug)
	);
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

	function print(picked: string[]) {
		const comps = picked.map(Number);
		if (comps.length >= left.length) onwhole();
		else void ctx.startPieces(slug, comps, label(comps.length));
	}
	function log(picked: string[]) {
		logComps = picked.map(Number);
		logging = true;
	}
</script>

{#if eligible && part}
	<button
		class={cls}
		type="button"
		data-testid={testid}
		aria-label="Print some pieces of {part.name}"
		onclick={() => (picking = true)}>Print some pieces…</button
	>
{/if}
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
