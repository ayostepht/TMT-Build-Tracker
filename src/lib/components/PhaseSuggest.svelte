<script lang="ts">
	import { updateBuild } from '#lib/client/api.ts';
	import { assemblyComplete, readyToAssemble } from '#lib/domain/index.ts';
	import type { BuildPhase } from '#lib/domain/types.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	const ctx = getBuildCtx();
	const view = $derived(ctx.view);

	const BEFORE_ASSEMBLY: BuildPhase[] = ['design', 'plates', 'printing'];
	const suggestion = $derived.by(
		(): { to: BuildPhase; id: string; text: string; label: string } | null => {
			const phase = view.build.phase;
			if (BEFORE_ASSEMBLY.includes(phase) && readyToAssemble(view).ready)
				return {
					to: 'assembly',
					id: 'assembly',
					text: 'Every part is printed.',
					label: 'Move to assembly?'
				};
			if (phase === 'assembly' && assemblyComplete(view))
				return {
					to: 'handoff',
					id: 'handoff',
					text: 'Every assembly step is done.',
					label: 'Move to handoff?'
				};
			return null;
		}
	);

	const key = (id: string) => `tmt-phase-dismissed:${ctx.id}:${id}`;
	let dismissed = $state<Record<string, boolean>>({});
	function isDismissed(id: string): boolean {
		if (dismissed[id]) return true;
		try {
			return localStorage.getItem(key(id)) === '1';
		} catch {
			return false;
		}
	}
	function dismiss(id: string) {
		dismissed[id] = true;
		try {
			localStorage.setItem(key(id), '1');
		} catch {
			/* private mode: the banner just returns next visit */
		}
	}
	let busy = $state(false);
	async function move(to: BuildPhase) {
		busy = true;
		await ctx.act(() => updateBuild(ctx.id, { phase: to }));
		busy = false;
	}
</script>

{#if suggestion && ctx.canEdit && !isDismissed(suggestion.id)}
	<div class="phase-suggest" role="note">
		<span>{suggestion.text} <b>{suggestion.label}</b></span>
		<span class="acts">
			<button
				type="button"
				class="btn primary sm"
				disabled={busy}
				onclick={() => move(suggestion.to)}>Yes, move on</button
			>
			<button type="button" class="btn sm" onclick={() => dismiss(suggestion.id)}>Not yet</button>
		</span>
	</div>
{/if}

<style>
	.phase-suggest {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		background: var(--accent-soft);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 14px;
		margin-bottom: 12px;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
</style>
