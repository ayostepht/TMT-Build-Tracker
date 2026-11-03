<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { moveBuild } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	type Workspace = { id: string; name: string; slug: string; role: string; personal: boolean };

	const ctx = getBuildCtx();
	const workspaces = $derived(((page.data as { teams?: Workspace[] }).teams ?? []) as Workspace[]);
	const current = $derived(workspaces.find((t) => t.id === ctx.view.build.organizationId));
	const targets = $derived(
		workspaces.filter((t) => !t.personal && (t.role === 'owner' || t.role === 'editor'))
	);
	let choice = $state('');
	let confirming = $state(false);
	const target = $derived(targets.find((t) => t.id === (choice || targets[0]?.id)));

	async function move() {
		if (!target) return;
		if (await ctx.act(() => moveBuild(ctx.id, target.id)))
			await goto(resolve('/(app)/teams/[slug]', { slug: target.slug }));
	}
</script>

{#if current?.personal && ctx.view.role === 'owner'}
	<section class="card">
		<h2>Move to chapter</h2>
		{#if targets.length}
			<p class="muted">
				Share this build with a chapter you own or edit. Its members will see it and can work on it.
			</p>
			{#if !confirming}
				<div class="form-grid">
					<label class="field"
						>Chapter
						<select bind:value={choice}>
							{#each targets as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
						</select>
					</label>
				</div>
				<div>
					<button class="btn" type="button" onclick={() => (confirming = true)}
						>Move to chapter…</button
					>
				</div>
			{:else}
				<div role="alertdialog" aria-label="Confirm move" style="display:grid;gap:10px">
					<strong>Move "{ctx.view.build.name}" to {target?.name}?</strong>
					<div>
						<button class="btn primary" type="button" onclick={move}>Move build</button>
						<button class="btn" type="button" onclick={() => (confirming = false)}>Cancel</button>
					</div>
				</div>
			{/if}
		{:else}
			<p class="muted">
				You are not part of a chapter yet. <a href={resolve('/(app)/onboarding')}
					>Create a chapter</a
				> to share this build.
			</p>
		{/if}
	</section>
{/if}
