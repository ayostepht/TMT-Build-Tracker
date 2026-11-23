<script lang="ts">
	import type { Plate } from '#lib/domain/types.ts';
	import { betweenRuns, printingPieces } from '#lib/domain/index.ts';
	import { defaultRunParts } from '#lib/domain/run-choice.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import LogRunSheet from './LogRunSheet.svelte';
	import StartOnPrinter from './StartOnPrinter.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import PartPickSheet, { type PickItem } from './PartPickSheet.svelte';
	import PartPiecesAction, { piecesOffered } from './PartPiecesAction.svelte';

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
	 * plus, below the statuses, "Print some parts…" or "Print some pieces…" where they apply (menu
	 * entries, not statuses), and a small "Log a print…" action while nothing is on the printer. Start and Take off are
	 * optimistic and offer Undo (see `BuildCtx.startParts` / `takeOffParts`). Editors get the menu;
	 * viewers see the plain badge.
	 *
	 * Props: `plate` (required); `only` narrows Start and the log to one part (a rim run on a
	 * perPartRuns plate); `size` 'sm' (default, plate headings) or 'md' (card footers);
	 * `alwaysLog` keeps "Log a print…" when every part is already printed (Files tab); `pieces` (default
	 * true) adds "Print some pieces…" when the plate's only startable part has several pieces.
	 */
	let {
		plate,
		only = null,
		size = 'sm',
		alwaysLog = false,
		pieces = true,
		badge = true,
		bare = false
	}: {
		plate: Plate;
		only?: string | null;
		size?: 'sm' | 'md';
		alwaysLog?: boolean;
		/** Offer "Print some pieces…" when the plate's only startable part has several pieces (a part row that has its own button turns it off). */
		pieces?: boolean;
		/** Show the status badge (false: a solo plate's heading, whose part row carries the badge). */
		badge?: boolean;
		/** Render nothing visible, only the sheets; the part row calls `pick` (see `isSoloPlate`). */
		bare?: boolean;
	} = $props();
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	let open = $state(false);
	let where = $state(false);
	let picking = $state(false);
	// The parts picked in "Print some parts…" while the "Where is it printing?" dialog is open.
	let someSlugs = $state<string[] | null>(null);
	$effect(() => {
		if (!where) someSlugs = null;
	});
	let logPicked = $state<string[] | null>(null);
	let logSome = $state(false);

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
	// One part on the printer with only some of its pieces: the log covers just those pieces. (With
	// other parts on the printer at once the log is for whole parts; pieces are logged from the part.)
	const piecesOn = $derived(
		on.length === 1 && logSlugs.length === 1 ? printingPieces(ctx.view, on[0]) : null
	);
	const piecesTitle = $derived.by(() => {
		if (!piecesOn?.length) return '';
		const p = ctx.view.parts.find((x) => x.slug === on[0]);
		return `${piecesOn.length} of ${p?.components.length ?? piecesOn.length} pieces of ${p?.name ?? on[0]}`;
	});
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
	const partsLabel = (n: number) => `${n} ${n === 1 ? 'part' : 'parts'} of plate ${plate.number}`;
	// "2 of 3 parts of plate 10: Headrest Bolt, Rear Caster Mount Left" for the printer dialog.
	const partsNote = (slugs: string[]) =>
		`${slugs.length} of ${plate.parts.length} parts of plate ${plate.number}: ${slugs
			.map((s) => ctx.view.parts.find((x) => x.slug === s)?.name ?? s)
			.join(', ')}`;
	const choices = $derived(
		plate.perPartRuns && !only && idle.length > 1
			? idle.map((s) => ({ slug: s, name: name(s) }))
			: []
	);

	// "Print some parts…": a single-run plate with two or more parts still to start. Not for a
	// perPartRuns plate (it already prints one part per run) or a plate with one part left.
	const canPickSome = $derived(
		ctx.canEdit && !plate.perPartRuns && !only && plate.runs <= 1 && idle.length >= 2
	);
	// "Print some pieces…" sits here when the plate's only startable part is one with several pieces
	// (Plate 18: Harness and Straps, alone on its plate); `PartPiecesAction` checks the rest.
	const pieceSlug = $derived(
		pieces && badge && !plate.perPartRuns && !only && plate.runs <= 1 && idle.length === 1
			? idle[0]
			: null
	);
	// The status menu's extra actions (below the statuses): "Print some parts…" or "Print some pieces…".
	let piecesPicking = $state(false);
	const offerPieces = $derived(!!pieceSlug && piecesOffered(ctx, pieceSlug));
	const extras = $derived.by(() => {
		const out: { label: string; testid: string; ariaLabel: string; run: () => void }[] = [];
		// "Not printing" (the plate, or on a one-part-per-run plate this part) comes first so the
		// "Print some …" entries stay last. Never offered once everything is Printed (no menu then).
		const sk = scope.filter((s) => ctx.view.state[s]);
		if (
			ctx.canEdit &&
			sk.length &&
			!sk.some((s) => status(s) === 'Printing') &&
			!sk.every((s) => status(s) === 'Printed')
		)
			out.push({
				label: only ? 'Not printing this part' : 'Not printing this plate',
				testid: 'plate-skip',
				ariaLabel: only
					? `Not printing ${name(only)} of plate ${plate.number}`
					: `Not printing plate ${plate.number}`,
				run: () => void ctx.skipParts(sk, only ? name(only) : `Plate ${plate.number}`)
			});
		if (canPickSome)
			out.push({
				label: 'Print some parts…',
				testid: 'plate-print-some',
				ariaLabel: `Print some parts of plate ${plate.number}`,
				run: () => (picking = true)
			});
		if (offerPieces && pieceSlug) {
			const pn = ctx.view.parts.find((x) => x.slug === pieceSlug)?.name ?? pieceSlug;
			out.push({
				label: 'Print some pieces…',
				testid: 'plate-print-some-pieces',
				ariaLabel: `Print some pieces of ${pn}`,
				run: () => (piecesPicking = true)
			});
		}
		return out;
	});
	// Some parts: one start for exactly them. All of what is left is the plate's own Printing action,
	// unless parts of the plate are already Printed or on the printer: then the job is still only for
	// the parts being started, so it takes the same path as a pick.
	function printSome(picked: string[]) {
		const activeParts = plate.parts.filter((s) => ctx.view.state[s]).length;
		if (picked.length >= activeParts || (picked.length >= idle.length && !hasPrinter)) {
			pick('Printing');
		} else if (hasPrinter) {
			someSlugs = picked;
			where = true;
		} else void ctx.startParts(picked, partsLabel(picked.length));
	}
	const pickItems = $derived<PickItem[]>(
		idle.map((s) => {
			const p = ctx.view.parts.find((x) => x.slug === s);
			return { id: s, name: p?.name ?? s, hint: filLabel(ctx.filament(p?.role ?? ''), p?.role) };
		})
	);
	function logSomeParts(picked: string[]) {
		logPicked = picked;
		logSome = true;
	}

	/** Run a status pick for the plate (also called by a solo plate's part row). */
	export function pick(s: string) {
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

<span class="plate-control" class:bare>
	{#if badge && !bare}<StatusBadge
			label={only ? `${name(only)}, plate ${plate.number}` : `Plate ${plate.number}`}
			status={plateStatus}
			{options}
			interactive={ctx.canEdit}
			onpick={pick}
			{extras}
			testid="plate-status"
		/>{/if}
	{#if ctx.canEdit}
		{#if !on.length && canLog && !bare}
			<button
				class="{cls} ghost plc-text"
				type="button"
				aria-label="Log a print on plate {plate.number}"
				onclick={() => (open = true)}>Log a print…</button
			>
		{/if}
		{#if pieceSlug}
			<PartPiecesAction
				slug={pieceSlug}
				bind:picking={piecesPicking}
				onwhole={() => pick('Printing')}
			/>
		{/if}
		<StartOnPrinter
			bind:open={where}
			slugs={someSlugs ?? startSlugs}
			plateNumber={plate.number}
			label={someSlugs ? partsLabel(someSlugs.length) : startLabel}
			parts={someSlugs ? [] : choices}
			partial={!!someSlugs}
			note={someSlugs ? partsNote(someSlugs) : ''}
			{confirm}
		/>
	{/if}
</span>
{#if ctx.canEdit}
	<PartPickSheet
		bind:open={picking}
		title="Print some parts of plate {plate.number}"
		items={pickItems}
		onprint={printSome}
		onlog={logSomeParts}
	/>
	{#if logPicked}
		<LogRunSheet
			bind:open={logSome}
			quick
			plateNumber={plate.number}
			slugs={logPicked}
			title="Log a print: {logPicked.length} of {plate.parts.length} parts, plate {plate.number}"
		/>
	{/if}
	<LogRunSheet
		bind:open
		quick={logSlugs.length > 0}
		plateNumber={plate.number}
		slugs={sheetSlugs}
		comps={piecesOn}
		{startedAt}
		title={piecesOn?.length
			? `Finish & log: ${piecesTitle}`
			: on.length
				? `Finish & log plate ${plate.number}`
				: `Log a print: plate ${plate.number}`}
	/>
{/if}

<style>
	.plate-control.bare {
		display: contents;
	}
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
