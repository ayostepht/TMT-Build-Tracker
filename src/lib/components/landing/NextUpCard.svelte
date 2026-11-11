<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Plate } from '#lib/domain/types.ts';
	import { getBuildCtx } from '../build-context.svelte.ts';
	import PlateControl from '../PlateControl.svelte';
	import PlateTime from '../PlateTime.svelte';
	import RoleChip from '../RoleChip.svelte';

	/** One build's next plate to print, with the shared start control (Start printing is one tap). */
	let { plate }: { plate: Plate } = $props();
	const ctx = getBuildCtx();
	const roles = $derived(
		[
			...new Set(
				plate.parts
					.map((s) => ctx.view.parts.find((p) => p.slug === s)?.role)
					.filter((r): r is string => !!r)
			)
		].slice(0, 4)
	);
	const todo = $derived(
		plate.parts.filter((s) => ['To print', 'Reprint'].includes(ctx.view.state[s]?.status ?? ''))
			.length
	);
</script>

<article class="nu-card" data-testid="next-up-card" data-plate={plate.number}>
	<div class="nu-head">
		<div class="nu-build">
			<a href={resolve('/(app)/builds/[id]', { id: ctx.id })}>{ctx.view.build.name}</a>
		</div>
		<div class="nu-plate">Plate {plate.number}{plate.name ? ` · ${plate.name}` : ''}</div>
	</div>
	<div class="nu-meta">
		<span class="muted">{todo} part{todo === 1 ? '' : 's'} to print</span>
		{#each roles as r (r)}<RoleChip filament={ctx.filament(r)} role={r} />{/each}
		<PlateTime {plate} />
	</div>
	<div class="nu-actions"><PlateControl {plate} size="md" /></div>
</article>

<style>
	.nu-card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px;
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.nu-build {
		font: 600 12px/1 var(--f-body);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-bottom: 6px;
	}
	.nu-build a {
		color: var(--muted);
		text-decoration: none;
	}
	.nu-build a:hover {
		color: var(--accent);
	}
	.nu-plate {
		font: 600 22px/1.15 var(--f-head);
		overflow-wrap: anywhere;
	}
	.nu-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
</style>
