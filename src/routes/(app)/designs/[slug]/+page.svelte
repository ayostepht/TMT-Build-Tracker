<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { applyDesign, createBuild, deleteDesign, updateDesignMeta } from '#lib/client/api.ts';
	import ModelStage from '#lib/components/design/ModelStage.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const d = $derived(data.design);

	const colors = $derived(
		Object.fromEntries(
			d.parts.flatMap((p) => {
				const r = d.roles.find((x) => x.key === p.role);
				return r ? [[p.slug, r.hex] as const] : [];
			})
		)
	);
	const bySlot = $derived(
		d.roles.map((r) => ({ role: r, parts: d.parts.filter((p) => p.role === r.key) }))
	);

	let workspace = $state('');
	let buildName = $state('');
	let target = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);

	$effect(() => {
		if (!workspace) workspace = data.targets.workspaces[0]?.id ?? '';
		if (!target) target = data.targets.builds[0]?.id ?? '';
		if (!buildName) buildName = `${d.name} chair`;
	});

	async function run(fn: () => Promise<void>) {
		error = null;
		note = null;
		busy = true;
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : 'That did not work.';
		} finally {
			busy = false;
		}
	}

	const start = () =>
		run(async () => {
			if (!buildName.trim()) throw new Error('Give the build a name.');
			const id = await createBuild({
				organizationId: workspace,
				templateId: d.templateId,
				designId: d.id,
				name: buildName.trim()
			});
			await goto(resolve('/(app)/builds/[id]', { id }));
		});

	const copy = () =>
		run(async () => {
			const b = data.targets.builds.find((x) => x.id === target);
			if (!b) throw new Error('Pick a build.');
			if (
				!confirm(
					`Replace the colors of "${b.name}" with "${d.name}"? Filament names, materials, colors and every part's slot change. Spools and print progress stay.`
				)
			)
				return;
			await applyDesign(d.id, b.id);
			await goto(resolve('/(app)/builds/[id]/design', { id: b.id }));
		});

	const togglePublic = () =>
		run(async () => {
			await updateDesignMeta(d.id, { isPublic: !d.isPublic });
			await invalidateAll();
			note = d.isPublic ? 'Now private.' : 'Now public.';
		});

	const remove = () =>
		run(async () => {
			if (!confirm(`Delete "${d.name}"? Builds already made from it keep their colors.`)) return;
			await deleteDesign(d.id);
			await goto(resolve('/(app)/designs'));
		});
</script>

<svelte:head><title>{d.name} · Designs · TMT Build Tracker</title></svelte:head>

<section class="stack">
	<a class="crumb" href={resolve('/(app)/designs')}>All designs</a>
	<div class="kicker">{d.templateName}</div>
	<h1>{d.name}</h1>
	<p class="muted">
		{d.authorName ? `By ${d.authorName}` : 'Included with the kit'} · {d.isPublic
			? 'public'
			: 'private'}
	</p>

	<div class="cols">
		<div class="stagebox">
			{#if data.model}
				<ModelStage model={data.model} {colors} siteAdmin={data.siteAdmin} label="Design preview" />
			{:else if d.hasSnapshot}
				<img class="snap" src="/api/designs/{d.id}/snapshot.png" alt="Preview of {d.name}" />
			{:else}
				<ModelStage model={null} {colors} siteAdmin={data.siteAdmin} />
			{/if}
		</div>

		<div class="side">
			<section class="card">
				<h2>Filaments</h2>
				<ul class="slots">
					{#each bySlot as s (s.role.key)}
						<li data-role={s.role.key}>
							<Swatch hex={s.role.hex} tpu={/^tp/i.test(s.role.material)} />
							<span class="txt">
								<b>{filamentLabel(s.role, s.role.key)}</b>
								<span class="muted">{s.role.material} · {s.parts.length} parts</span>
								<span class="muted parts"
									>{s.parts.map((p) => p.name).join(', ') || 'No parts'}</span
								>
							</span>
						</li>
					{/each}
				</ul>
			</section>

			{#if error}<div class="error" role="alert">{error}</div>{/if}
			{#if note}<div class="muted" role="status">{note}</div>{/if}

			<section class="card">
				<h2>Start a build from this design</h2>
				{#if data.targets.workspaces.length}
					<label class="field">
						Workspace
						<select bind:value={workspace}>
							{#each data.targets.workspaces as w (w.id)}<option value={w.id}>{w.name}</option
								>{/each}
						</select>
					</label>
					<label class="field">
						Build name
						<input bind:value={buildName} maxlength="200" />
					</label>
					<button class="btn primary" disabled={busy} onclick={start}>Start a build</button>
				{:else}
					<p class="muted">You need to be an editor in a workspace to start a build.</p>
				{/if}
			</section>

			{#if data.targets.builds.length}
				<section class="card">
					<h2>Copy into my build</h2>
					<label class="field">
						Build
						<select bind:value={target}>
							{#each data.targets.builds as b (b.id)}
								<option value={b.id}>{b.name} ({b.workspaceName})</option>
							{/each}
						</select>
					</label>
					<button class="btn" disabled={busy} onclick={copy}>Copy into my build…</button>
				</section>
			{/if}

			{#if d.mine}
				<section class="card">
					<h2>Manage</h2>
					<div class="acts">
						<button class="btn" disabled={busy} onclick={togglePublic}>
							{d.isPublic ? 'Make private' : 'Share publicly'}
						</button>
						<button class="btn danger" disabled={busy} onclick={remove}>Delete design</button>
					</div>
					<label class="field">
						Link
						<input
							readonly
							value="{page.url.origin}/designs/{d.slug}"
							onfocus={(e) => e.currentTarget.select()}
						/>
					</label>
				</section>
			{/if}
		</div>
	</div>
</section>

<style>
	h1,
	h2,
	p {
		margin: 0;
	}
	.cols {
		display: grid;
		gap: 16px;
		align-items: start;
	}
	.stagebox {
		height: 55vh;
		min-height: 260px;
	}
	.snap {
		width: 100%;
		border-radius: 10px;
		border: 1px solid var(--line);
	}
	.side {
		display: grid;
		gap: 14px;
		min-width: 0;
	}
	.slots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.slots li {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.txt {
		display: grid;
		min-width: 0;
	}
	.parts {
		font-size: 13px;
	}
	.acts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	select,
	input {
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
		font-size: 15px;
	}
	@media (min-width: 900px) {
		.cols {
			grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr);
		}
		.stagebox {
			height: min(70vh, 680px);
			position: sticky;
			top: 12px;
		}
	}
</style>
