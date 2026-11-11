<script lang="ts" module>
	import { buildSpoolman, type SpoolDto } from '#lib/client/api.ts';

	class SpoolInfo {
		configured = $state(false);
		linked = $state<Record<string, SpoolDto | null>>({});
		error = $state('');
		loadedKey = '';
		loading = false;
		async load(buildId: string, key: string) {
			if (this.loading || this.loadedKey === key) return;
			this.loading = true;
			this.loadedKey = key;
			try {
				const r = await buildSpoolman(buildId);
				this.configured = r.configured;
				this.linked = r.linked;
				this.error = r.error ?? '';
			} catch (e) {
				this.error = e instanceof Error ? e.message : 'Spoolman failed';
			}
			this.loading = false;
		}
	}
	const infos = new WeakMap<object, SpoolInfo>();
</script>

<script lang="ts">
	import { fmt } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/** Remaining grams on the Spoolman spool linked to a filament role (renders nothing when not linked). */
	let { role }: { role: string } = $props();
	const ctx = getBuildCtx();
	let info = infos.get(ctx);
	if (!info) infos.set(ctx, (info = new SpoolInfo()));
	const inf = info;
	const spoolId = $derived(ctx.filament(role)?.spoolmanSpoolId ?? null);
	// Reload when any link changes or a run is logged (runs change what a spool has left).
	const key = $derived(
		ctx.view.filaments.map((f) => `${f.key}:${f.spoolmanSpoolId ?? ''}`).join(',') +
			'|' +
			ctx.view.runs.length
	);
	$effect(() => {
		if (spoolId != null) void inf.load(ctx.id, key);
	});
	const sp = $derived(inf.linked[role]);
</script>

{#if spoolId != null}
	<div class="spoolman" data-testid="spool-remaining">
		{#if inf.error}
			<span class="warn" title={inf.error}>Spoolman unreachable</span>
		{:else if sp}
			<b class="num">{sp.remainingG != null ? `${fmt(sp.remainingG)} g` : '?'}</b> left on Spoolman
			spool #{sp.id}
		{:else if inf.configured}
			Spoolman spool #{spoolId} not found
		{/if}
	</div>
{/if}

<style>
	.spoolman {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.warn {
		color: var(--warn);
	}
</style>
