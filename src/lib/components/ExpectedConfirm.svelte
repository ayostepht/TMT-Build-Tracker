<script lang="ts">
	import { untrack } from 'svelte';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { jobAction } from '#lib/client/api.ts';
	import type { PrinterExpectedView } from '#lib/printers/status.ts';
	import { getBuildCtx, type BuildCtx } from './build-context.svelte.ts';
	import { runChoices, runOptionLabel } from './run-label.ts';

	/**
	 * "Confirm Plate 13 · Wheel rims is printing on <printer>?": the user sent this plate to the
	 * printer ("Start on <printer>") and the printer now runs a job nobody has linked. One tap links it.
	 */
	let {
		exp,
		onother,
		ctx: ctxProp,
		onlinked
	}: {
		exp: PrinterExpectedView;
		onother: () => void;
		/** Outside a build page (the Printers page) the build's context is passed in. */
		ctx?: BuildCtx;
		onlinked?: () => void | Promise<void>;
	} = $props();
	const ctx = untrack(() => ctxProp ?? getBuildCtx());
	const store = untrack(() =>
		onlinked ? null : printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id)
	);

	const plate = $derived(ctx.view.plates.find((p) => p.number === exp.plateNumber));
	const label = $derived.by(() => {
		let t = `Plate ${exp.plateNumber}${plate?.name ? ` · ${plate.name}` : ''}`;
		const slug = exp.partSlugs?.[0];
		const c = slug ? runChoices(ctx.view, exp.plateNumber).find((x) => x.slug === slug) : null;
		if (c) t += ` · ${runOptionLabel(ctx, c)}`;
		return t;
	});

	let busy = $state(false);
	let err = $state('');
	async function confirm() {
		busy = true;
		err = '';
		try {
			await jobAction(exp.jobId, {
				action: 'link',
				buildId: ctx.id,
				plateNumber: exp.plateNumber,
				partSlugs: exp.partSlugs ?? undefined
			});
			await ctx.refresh();
			if (onlinked) await onlinked();
			else await store?.load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'That did not work.';
		}
		busy = false;
	}
</script>

<div class="exp-confirm" data-testid="expected-confirm">
	<p class="exp-q">Confirm <b>{label}</b> is printing on {exp.printerName}?</p>
	<div class="exp-actions">
		<button
			class="btn sm primary"
			type="button"
			data-testid="expected-confirm-go"
			disabled={busy}
			onclick={confirm}>Confirm</button
		>
		<button class="btn sm" type="button" data-testid="expected-other" onclick={onother}
			>Different plate</button
		>
	</div>
	{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}
</div>

<style>
	.exp-confirm {
		display: grid;
		gap: var(--sp-4);
		flex-basis: 100%;
		width: 100%;
	}
	.exp-q {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.exp-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
</style>
