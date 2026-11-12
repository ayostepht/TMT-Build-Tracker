<script lang="ts">
	import type { Plate } from '#lib/domain/types.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import LogRunSheet from './LogRunSheet.svelte';
	import StartOnPrinter from './StartOnPrinter.svelte';

	/**
	 * THE start / finish / log control for a plate, used on the Print tab (plate headings and part
	 * detail), the Files tab (plate cards) and the Now printing card, so they read and behave alike:
	 *
	 *  - nothing on the printer: **Printing on <printer>** (primary, with a printer) or **Start printing** (none), plus "Not on a connected printer", then **Log a print…**
	 *  - parts on the printer: **Finish & log** (log sheet, Success preselected) and **Take off printer**
	 *
	 * Start, Take off printer and per-part status changes are optimistic and offer Undo (see
	 * `BuildCtx.startParts` / `takeOffParts`). Editors only; renders nothing for viewers.
	 *
	 * Props: `plate` (required); `only` narrows Start and the log to one part (a rim run on a
	 * perPartRuns plate); `size` 'sm' (default, plate headings) or 'md' (card footers);
	 * `alwaysLog` keeps "Log a print…" when every part is already printed (Files tab).
	 */
	let {
		plate,
		only = null,
		size = 'sm',
		alwaysLog = false
	}: {
		plate: Plate;
		only?: string | null;
		size?: 'sm' | 'md';
		alwaysLog?: boolean;
	} = $props();
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	// With a printer connected the printer button is the main start; the plain one is the exception.
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	let open = $state(false);

	const status = (s: string) => ctx.view.state[s]?.status;
	const scope = $derived(only ? [only] : plate.parts);
	const on = $derived(scope.filter((s) => status(s) === 'Printing'));
	const idle = $derived(scope.filter((s) => !['Printed', 'Printing'].includes(status(s) ?? '')));
	const unprinted = $derived(plate.parts.filter((s) => status(s) !== 'Printed'));
	// What a log covers: the parts on the printer when any are, else every part still to do.
	const logSlugs = $derived.by(() => {
		if (plate.perPartRuns) {
			const first = only ?? on[0] ?? null;
			return first && unprinted.includes(first)
				? [first, ...unprinted.filter((s) => s !== first)]
				: unprinted;
		}
		const printing = unprinted.filter((s) => status(s) === 'Printing');
		return printing.length ? printing : unprinted;
	});
	const sheetSlugs = $derived(logSlugs.length ? logSlugs : plate.parts);
	const startedAt = $derived(
		plate.parts
			.map((s) => (status(s) === 'Printing' ? ctx.view.state[s].startedAt : null))
			.filter((s): s is string => !!s)
			.sort()[0] ?? null
	);
	const name = (slug: string) => {
		const p = ctx.view.parts.find((x) => x.slug === slug);
		return filLabel(ctx.filament(p?.role ?? ''), p?.name);
	};
	const cls = $derived(size === 'sm' ? 'btn sm' : 'btn');
	const canLog = $derived(logSlugs.length > 0 || alwaysLog);

	async function takeOff() {
		await ctx.takeOffParts(on, `plate ${plate.number}`);
		// the printer's running job is unlinked now: show it in "Link to plate…" at once
		void printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id).load();
	}
</script>

{#if ctx.canEdit}
	<span class="plate-control">
		{#if on.length}
			<button
				class="{cls} primary"
				type="button"
				aria-label="Finish & log plate {plate.number}"
				onclick={() => (open = true)}>Finish &amp; log</button
			>
			<button
				class="{cls} ghost plc-text"
				type="button"
				aria-label="Take off printer, plate {plate.number}"
				onclick={takeOff}>Take off printer</button
			>
		{/if}
		{#if idle.length}
			{#if plate.perPartRuns}
				{#each idle as slug (slug)}
					<StartOnPrinter
						slugs={[slug]}
						plateNumber={plate.number}
						{size}
						primary={!on.length}
						partName={name(slug)}
					/>
					<button
						class="{cls}{hasPrinter ? ' ghost plc-text' : ''}"
						class:primary={!hasPrinter && !on.length && idle.length === 1}
						type="button"
						aria-label="Start {name(slug)} run on plate {plate.number}"
						onclick={() => ctx.startParts([slug], `${name(slug)} run, plate ${plate.number}`)}
						>{hasPrinter
							? `${name(slug)}: not on a connected printer`
							: `Start ${name(slug)} run`}</button
					>
				{/each}
			{:else}
				<StartOnPrinter slugs={idle} plateNumber={plate.number} {size} primary={!on.length} />
				<button
					class="{cls} {hasPrinter ? 'ghost plc-text' : 'primary'}"
					type="button"
					aria-label="Start printing plate {plate.number}"
					onclick={() => ctx.startParts(idle, `plate ${plate.number}`)}
					>{hasPrinter ? 'Not on a connected printer' : 'Start printing'}</button
				>
			{/if}
		{/if}
		{#if !on.length && canLog}
			<button
				class="{cls} {idle.length ? 'ghost plc-text' : 'primary'}"
				type="button"
				aria-label="Log a print on plate {plate.number}"
				onclick={() => (open = true)}>Log a print…</button
			>
		{/if}
	</span>
	<LogRunSheet
		bind:open
		quick={logSlugs.length > 0}
		plateNumber={plate.number}
		slugs={sheetSlugs}
		{startedAt}
		title={on.length ? `Finish & log plate ${plate.number}` : `Log a print: plate ${plate.number}`}
	/>
{/if}

<style>
	.plate-control {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		align-items: center;
		min-width: 0;
	}
	/* One height for every action in the row (filled, outlined and text-style, StartOnPrinter
	   included); 44px where a thumb taps. */
	@media (pointer: coarse), (max-width: 760px) {
		.plate-control :global(.btn) {
			box-sizing: border-box;
			min-height: 44px;
		}
	}
	/* Text-style actions carry no inline padding: their label sits on the row's left edge when the
	   row wraps and the visible gap to the next action is the row gap, not padding + gap. */
	.plate-control :global(.btn.plc-text) {
		padding-inline: 0;
		/* with the row gap: 16px between a text action and whatever follows it */
		margin-inline-end: var(--sp-4);
		min-width: 44px;
		justify-content: flex-start;
	}
</style>
