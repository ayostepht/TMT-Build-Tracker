<script lang="ts">
	import { expectOnPrinter, printing } from '#lib/client/api.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import ExpectedConfirm from './ExpectedConfirm.svelte';

	/**
	 * "Start printing on <printer>" for plates, shown when the team has printers connected.
	 * It marks the parts as printing and tells the server which plate that printer's next job is.
	 * (It does not send anything to the printer: start the print there.)
	 */
	let {
		slugs,
		plateNumber,
		size = 'sm',
		primary = true,
		partName = null
	}: {
		slugs: string[];
		plateNumber: number;
		size?: 'sm' | 'md';
		/** The first printer's button is the primary action (false when Finish & log already is). */
		primary?: boolean;
		/** perPartRuns plates: the part (color) this run is for, named in the label. */
		partName?: string | null;
	} = $props();
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => store.acquire());
	const list = $derived(store.printers.filter((p) => p.enabled));

	async function go(printerId: string) {
		await ctx.act(async () => {
			await printing(ctx.id, { action: 'start', slugs });
			// perPartRuns plates print one part (color) per job: tell the server which.
			const perPart = ctx.view.plates.find((p) => p.number === plateNumber)?.perPartRuns;
			await expectOnPrinter(printerId, ctx.id, plateNumber, perPart ? slugs : undefined);
		});
		// If that printer already runs an unlinked job, the confirmation shows right here.
		dismissed = false;
		await store.load();
	}

	let dismissed = $state(false);
	const asking = $derived(
		dismissed
			? []
			: store.expected.filter((e) => e.buildId === ctx.id && e.plateNumber === plateNumber)
	);
</script>

{#if ctx.canEdit && list.length}
	{#each list as p, i (p.id)}
		<button
			class="btn{size === 'sm' ? ' sm' : ''}{primary && i === 0 ? ' primary' : ''}"
			type="button"
			title="Marks the plate as printing and links the next job from {p.name} to it"
			data-testid="start-on-printer"
			onclick={() => go(p.id)}>{partName ? `${partName}: ` : ''}Printing on {p.name}</button
		>
	{/each}
	<span class="sop-help muted" data-testid="start-on-printer-help"
		>Start the print at the printer. This marks the plate as printing and follows that printer's
		job.</span
	>
{/if}
{#if ctx.canEdit}
	{#each asking as e (e.printerId)}
		<ExpectedConfirm exp={e} onother={() => (dismissed = true)} />
	{/each}
{/if}

<style>
	.sop-help {
		flex-basis: 100%;
		font-size: var(--fs-sm, 13px);
		line-height: 1.35;
		max-width: 46ch;
	}
</style>
