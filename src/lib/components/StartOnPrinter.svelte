<script lang="ts">
	import { expectOnPrinter, jobAction, printing } from '#lib/client/api.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import { toasts } from './toast.svelte.ts';
	import ExpectedConfirm from './ExpectedConfirm.svelte';
	import WherePrinting from './WherePrinting.svelte';

	/**
	 * The "Where is it printing?" step behind choosing Printing on a plate or a part (the status
	 * badge menus in PlateControl and PartRow open it with `open`). Confirming with a printer marks
	 * the parts as printing and tells the server which plate that printer's next job is; "Not on a
	 * connected printer" ("Somewhere else" when a not-connected printer exists) is the plain start (optimistic, with Undo). It never sends anything to the
	 * printer: the print is started there. Without enabled printers callers skip this and start
	 * directly (`hasPrinters` false).
	 *
	 * Also shows the "Confirm Plate N is printing on <printer>?" follow-up when that printer already
	 * runs an unlinked job (`confirm`, one place per plate).
	 */
	let {
		open = $bindable(false),
		slugs,
		plateNumber,
		label,
		parts = [],
		confirm = true
	}: {
		open?: boolean;
		slugs: string[];
		plateNumber: number | null;
		/** Undo-toast wording for the plain start ("plate 2", "Handle Right run, plate 13"). */
		label?: string;
		/** perPartRuns plates with several parts left: lets the dialog choose which one. */
		parts?: { slug: string; name: string }[];
		/** Show the printer-already-running confirmation here (false where another control does). */
		confirm?: boolean;
	} = $props();
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => store.acquire());
	const list = $derived(store.printers.filter((p) => p.enabled));

	async function go(printerId: string, printerName: string, which: string[]) {
		await ctx.act(async () => {
			// The printer's name goes in the start activity: the log sheet prefills it from there.
			await printing(ctx.id, { action: 'start', slugs: which, printer: printerName });
			// perPartRuns plates print one part (color) per job: tell the server which.
			const perPart = ctx.view.plates.find((p) => p.number === plateNumber)?.perPartRuns;
			// A not-connected printer answers { manual: true } and queues nothing: no confirmation follows.
			await expectOnPrinter(printerId, ctx.id, plateNumber!, perPart ? which : undefined);
		});
		dismissed = false;
		await store.load();
		// The person just said where it prints: when that printer already runs an unlinked job for
		// this plate, link it now (what the confirm button does) instead of asking again.
		const exp = store.expected.find(
			(e) => e.printerId === printerId && e.buildId === ctx.id && e.plateNumber === plateNumber
		);
		if (exp) {
			try {
				await jobAction(exp.jobId, {
					action: 'link',
					buildId: ctx.id,
					plateNumber: exp.plateNumber,
					partSlugs: exp.partSlugs ?? undefined
				});
				await ctx.refresh();
				await store.load();
				toasts.push(`Linked ${printerName}'s print to plate ${exp.plateNumber}`);
			} catch {
				// Could not link: the usual confirmation below stays available.
			}
		}
	}

	function done(printerId: string | null, slug: string | null) {
		open = false;
		const which = slug ? [slug] : slugs;
		const chosen = printerId ? list.find((p) => p.id === printerId) : undefined;
		if (chosen && plateNumber != null) void go(chosen.id, chosen.name, which);
		else void ctx.startParts(which, label, chosen?.name);
	}

	let dismissed = $state(false);
	const asking = $derived(
		dismissed || plateNumber == null
			? []
			: store.expected.filter((e) => e.buildId === ctx.id && e.plateNumber === plateNumber)
	);
</script>

{#if ctx.canEdit && open}
	<WherePrinting printers={list} {parts} onconfirm={done} onclose={() => (open = false)} />
{/if}
{#if ctx.canEdit && confirm}
	{#each asking as e (e.printerId)}
		<ExpectedConfirm exp={e} onother={() => (dismissed = true)} />
	{/each}
{/if}
