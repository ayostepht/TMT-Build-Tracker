<script lang="ts">
	import { expectOnPrinter, printing } from '#lib/client/api.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/**
	 * "Start printing on <printer>" for plates, shown when the team has printers connected.
	 * It marks the parts as printing and tells the server which plate that printer's next job is.
	 * (It does not send anything to the printer: start the print there.)
	 */
	let { slugs, plateNumber }: { slugs: string[]; plateNumber: number } = $props();
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
	}
</script>

{#if ctx.canEdit && list.length}
	{#each list as p (p.id)}
		<button
			class="btn sm"
			type="button"
			title="Marks the plate as printing and links the next job from {p.name} to it"
			data-testid="start-on-printer"
			onclick={() => go(p.id)}>Start on {p.name}</button
		>
	{/each}
{/if}
