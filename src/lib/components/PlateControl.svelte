<script lang="ts">
	import type { Plate } from '#lib/domain/types.ts';
	import { betweenRuns } from '#lib/domain/index.ts';
	import { defaultRunParts } from '#lib/domain/run-choice.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import LogRunSheet from './LogRunSheet.svelte';
	import StartOnPrinter from './StartOnPrinter.svelte';
	import StatusBadge from './StatusBadge.svelte';

	/**
	 * THE status / start / finish / log control for a plate, used on the Print tab (plate headings and
	 * part detail), the Files tab (plate cards), the Now printing card and the landing's Next up card,
	 * so they read and behave alike. One status badge (To print, Printing, Printed, Partly printed,
	 * Reprint) that opens a menu of the statuses valid from here:
	 *
	 *  - **Printing**: with a printer connected the "Where is it printing?" dialog (StartOnPrinter);
	 *    without one the plate is marked directly
	 *  - **Printed**: the finish-and-log sheet (Success preselected)
	 *  - **To print**: take the parts off the printer without a log
	 *
	 * plus a small "Log a print…" action while nothing is on the printer. Start and Take off are
	 * optimistic and offer Undo (see `BuildCtx.startParts` / `takeOffParts`). Editors get the menu;
	 * viewers see the plain badge.
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
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	let open = $state(false);
	let where = $state(false);

	const status = (s: string) => ctx.view.state[s]?.status;
	const scope = $derived(only ? [only] : plate.parts);
	// "On the printer" = Printing with a run actually under way; a part between the runs of a
	// multi-run plate is still marked Printing but is not on the printer.
	const between = $derived(scope.filter((s) => betweenRuns(ctx.view, s)));
	const on = $derived(scope.filter((s) => status(s) === 'Printing' && !between.includes(s)));
	const idle = $derived(scope.filter((s) => status(s) !== 'Printed' && !on.includes(s)));
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
	// The "is it printing on <printer>?" follow-up belongs to a plate that still has parts to start,
	// as before; once started, the Overview's unlinked-job card is the one place that asks.
	const confirm = $derived(idle.length > 0);
	const canLog = $derived(logSlugs.length > 0 || alwaysLog);

	// The plate's status in one word. Printing wins; Reprint shows while a part awaits one.
	const plateStatus = $derived.by(() => {
		const sts = scope.map((s) => status(s) ?? 'To print');
		if (!sts.length) return 'To print';
		if (on.length) return 'Printing';
		if (sts.every((x) => x === 'Printed')) return 'Printed';
		if (sts.includes('Reprint')) return 'Reprint';
		return sts.includes('Printed') || between.length ? 'Partly printed' : 'To print';
	});
	// Statuses valid from here, in menu order. Starting needs a part that is not on the printer yet.
	const options = $derived.by(() => {
		const out: string[] = [];
		if (on.length || plateStatus === 'To print') out.push('To print');
		if (idle.length || on.length) out.push('Printing');
		if (canLog) out.push('Printed');
		return out;
	});
	// On a plate that prints one part per run: the part a plate-level start is for.
	const startSlugs = $derived.by(() => {
		if (!plate.perPartRuns) return idle;
		const d = only ? [only] : (defaultRunParts(ctx.view, plate.number) ?? []);
		const pick = d.filter((s) => idle.includes(s));
		return pick.length ? pick : idle.slice(0, 1);
	});
	const startLabel = $derived(
		plate.perPartRuns && startSlugs[0]
			? `${name(startSlugs[0])} run, plate ${plate.number}`
			: `plate ${plate.number}`
	);
	const choices = $derived(
		plate.perPartRuns && !only && idle.length > 1
			? idle.map((s) => ({ slug: s, name: name(s) }))
			: []
	);

	function pick(s: string) {
		if (s === 'Printing') {
			if (!startSlugs.length) return;
			if (hasPrinter) where = true;
			else void ctx.startParts(startSlugs, startLabel);
		} else if (s === 'Printed') open = true;
		else if (s === 'To print') void takeOff();
	}

	async function takeOff() {
		await ctx.takeOffParts(on, `plate ${plate.number}`);
		// the printer's running job is unlinked now: show it in "Link to plate…" at once
		void printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id).load();
	}
</script>

<span class="plate-control">
	<StatusBadge
		label={only ? `${name(only)}, plate ${plate.number}` : `Plate ${plate.number}`}
		status={plateStatus}
		{options}
		interactive={ctx.canEdit}
		onpick={pick}
		testid="plate-status"
	/>
	{#if ctx.canEdit}
		{#if !on.length && canLog}
			<button
				class="{cls} ghost plc-text"
				type="button"
				aria-label="Log a print on plate {plate.number}"
				onclick={() => (open = true)}>Log a print…</button
			>
		{/if}
		<StartOnPrinter
			bind:open={where}
			slugs={startSlugs}
			plateNumber={plate.number}
			label={startLabel}
			parts={choices}
			{confirm}
		/>
	{/if}
</span>
{#if ctx.canEdit}
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
