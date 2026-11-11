<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { applyDesign, createBuild, deleteDesign, updateDesignMeta } from '#lib/client/api.ts';
	import Dialog from '#lib/components/design/share/Dialog.svelte';
	import ModelStage from '#lib/components/design/ModelStage.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import { filamentLabel, roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import { tick } from 'svelte';
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
		sortRoles(d.roles, (r) => r.key).map((r) => ({
			role: r,
			parts: d.parts.filter((p) => p.role === r.key)
		}))
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

	let useCard = $state<HTMLElement>();
	let useHeading = $state<HTMLElement>();
	let nameInput = $state<HTMLInputElement>();
	let targetSelect = $state<HTMLSelectElement>();
	let flash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	/** The primary button: bring the Use card into view, focus its first control, and flash it. */
	async function goToUse() {
		if (!useCard) return;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const phone = window.matchMedia('(max-width: 899px)').matches;
		useCard.scrollIntoView({
			behavior: reduce ? 'auto' : 'smooth',
			block: phone ? 'start' : 'nearest'
		});
		(nameInput ?? targetSelect ?? useHeading)?.focus({ preventScroll: true });
		// Restart the highlight even on a repeat click.
		clearTimeout(flashTimer);
		flash = false;
		await tick();
		void useCard.offsetWidth;
		flash = true;
		flashTimer = setTimeout(() => (flash = false), 1400);
	}

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
			await goto(resolve('/(app)/builds/[id]/setup', { id }));
		});

	/** Which confirmation dialog is open (replaces the browser confirm()). */
	let asking = $state<'copy' | 'delete' | null>(null);
	const targetBuild = $derived(data.targets.builds.find((x) => x.id === target));

	const askCopy = () => {
		if (!targetBuild) {
			error = 'Pick a build.';
			return;
		}
		error = null;
		asking = 'copy';
	};

	const copy = () =>
		run(async () => {
			asking = null;
			const b = data.targets.builds.find((x) => x.id === target);
			if (!b) throw new Error('Pick a build.');
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
			asking = null;
			await deleteDesign(d.id);
			await goto(resolve('/(app)/designs'));
		});
</script>

<svelte:head><title>{d.name} · Designs · TMT Build Tracker</title></svelte:head>

<section class="page-stack">
	<a class="btn ghost sm back" href={resolve('/(app)/designs')}
		><span class="btn-arrow" aria-hidden="true">←</span> All designs</a
	>
	<div class="top">
		<div class="titles">
			<div class="kicker">{d.templateName}</div>
			<h1>{d.name}</h1>
			<p class="muted">
				{d.authorName ? `By ${d.authorName}` : 'Included with the kit'} · {d.isPublic
					? 'public'
					: 'private'}
			</p>
		</div>
		<button class="btn primary usebtn" data-testid="use-design" onclick={goToUse}
			>Use this design</button
		>
	</div>

	<div class="cols">
		<div class="stagebox">
			{#if data.model}
				<ModelStage
					model={data.model}
					{colors}
					hidden={data.hidden}
					siteAdmin={data.siteAdmin}
					label="Design preview"
				/>
			{:else if d.hasSnapshot}
				<img class="snap" src="/api/designs/{d.id}/snapshot.png" alt="Preview of {d.name}" />
			{:else}
				<ModelStage model={null} {colors} siteAdmin={data.siteAdmin} />
			{/if}
		</div>

		<div class="side">
			<section class="ds-card">
				<h2>Filaments</h2>
				<ul class="slots">
					{#each bySlot as s (s.role.key)}
						<li data-role={s.role.key}>
							<Swatch hex={s.role.hex} tpu={/^tp/i.test(s.role.material)} />
							<span class="txt">
								<b>{roleLabel(s.role.key, s.role)}</b>
								<span class="muted">{filamentLabel(s.role, s.role.key)}</span>
								<details class="parts">
									<summary>{s.parts.length} parts</summary>
									<span class="muted">{s.parts.map((p) => p.name).join(', ') || 'No parts'}</span>
								</details>
							</span>
						</li>
					{/each}
				</ul>
			</section>

			{#if error}<div class="error" role="alert">{error}</div>{/if}
			{#if note}<div class="muted" role="status">{note}</div>{/if}

			<section class="ds-card" id="use" class:flash bind:this={useCard}>
				<h2 tabindex="-1" bind:this={useHeading}>Use this design</h2>
				<div class="opt">
					<h3>Start a new build</h3>
					{#if data.targets.workspaces.length}
						<label class="field">
							Chapter or My builds
							<select bind:value={workspace}>
								{#each data.targets.workspaces as w (w.id)}<option value={w.id}>{w.name}</option
									>{/each}
							</select>
						</label>
						<label class="field">
							Build name
							<input bind:value={buildName} bind:this={nameInput} maxlength="200" />
						</label>
						<button class="btn primary" disabled={busy} onclick={start}>Start a build</button>
					{:else}
						<p class="muted">
							You need to be an editor in a chapter (or have My builds) to start a build.
						</p>
					{/if}
				</div>

				{#if data.targets.builds.length}
					<div class="opt">
						<h3>Or copy it into a build or draft you have</h3>
						<p class="muted small">
							Replaces that build's filament names, materials, colors and every part's slot. Spools
							and print progress stay.
						</p>
						<label class="field">
							Build or draft
							<select bind:value={target} bind:this={targetSelect}>
								{#each data.targets.builds as b (b.id)}
									<option value={b.id}>{b.name} ({b.workspaceName})</option>
								{/each}
							</select>
						</label>
						<button class="btn" disabled={busy} onclick={askCopy}>Copy into my build…</button>
					</div>
				{/if}
			</section>

			{#if d.mine}
				<section class="ds-card">
					<h2>Sharing</h2>
					<p class="muted small">
						{d.isPublic
							? 'Anyone signed in with this link can see and use this design.'
							: 'Only you can see this design. Share it publicly to give others the link.'}
					</p>
					<label class="field">
						Link
						<input
							readonly
							value="{page.url.origin}/designs/{d.slug}"
							onfocus={(e) => e.currentTarget.select()}
						/>
					</label>
					<div class="acts">
						<button class="btn" disabled={busy} onclick={togglePublic}>
							{d.isPublic ? 'Make private' : 'Share publicly'}
						</button>
						<button class="btn danger" disabled={busy} onclick={() => (asking = 'delete')}
							>Delete design</button
						>
					</div>
				</section>
			{/if}
		</div>
	</div>
</section>

{#if asking === 'copy' && targetBuild}
	<Dialog title="Replace colors?" onclose={() => (asking = null)} testid="copy-design-dialog">
		<div class="confirm">
			<p>
				Replace the colors of "{targetBuild.name}" with "{d.name}"? Filament names, materials,
				colors and every part's slot change. Spools and print progress stay.
			</p>
			<div class="acts">
				<button class="btn" type="button" onclick={() => (asking = null)}>Cancel</button>
				<button class="btn primary" type="button" disabled={busy} onclick={copy}>
					Replace colors
				</button>
			</div>
		</div>
	</Dialog>
{:else if asking === 'delete'}
	<Dialog
		title="Delete design?"
		onclose={() => (asking = null)}
		testid="delete-design-dialog"
		danger
	>
		<div class="confirm">
			<p>Delete "{d.name}"? Builds already made from it keep their colors.</p>
			<div class="acts">
				<button class="btn" type="button" data-cancel onclick={() => (asking = null)}>Cancel</button
				>
				<button class="btn danger" type="button" disabled={busy} onclick={remove}>
					Delete design
				</button>
			</div>
		</div>
	</Dialog>
{/if}

<style>
	.confirm {
		display: grid;
		gap: var(--sp-6);
	}
	.confirm p {
		margin: 0;
	}
	section.page-stack {
		display: grid;
		gap: var(--sp-8);
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	h3 {
		font-size: var(--fs-base);
	}
	.top {
		display: flex;
		gap: var(--sp-6);
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.titles {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
	}
	.usebtn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding-inline: var(--sp-9);
	}
	.cols {
		display: grid;
		gap: var(--sp-8);
		align-items: start;
	}
	.stagebox {
		height: 55vh;
		min-height: 260px;
	}
	.snap {
		width: 100%;
		border-radius: var(--r-lg);
		border: 1px solid var(--line);
	}
	.side {
		display: grid;
		gap: var(--sp-7);
		min-width: 0;
	}
	.slots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-6);
	}
	.slots li {
		display: flex;
		gap: var(--sp-5);
		align-items: flex-start;
	}
	.txt {
		display: grid;
		min-width: 0;
		gap: 1px;
	}
	.parts {
		font-size: var(--fs-sm);
	}
	.parts summary {
		cursor: pointer;
		color: var(--muted);
		width: fit-content;
	}
	#use {
		scroll-margin-top: var(--sp-6);
		gap: var(--sp-8);
	}
	#use h2:focus {
		outline: none;
	}
	#use.flash {
		animation: use-flash 1.4s ease-out;
	}
	@keyframes use-flash {
		0%,
		60% {
			outline: 3px solid var(--accent);
			outline-offset: 2px;
			box-shadow: 0 0 0 8px var(--accent-soft);
		}
		100% {
			outline: 3px solid transparent;
			outline-offset: 2px;
			box-shadow: 0 0 0 8px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		#use.flash {
			animation: none;
			outline: 3px solid var(--accent);
			outline-offset: 2px;
		}
	}
	.opt {
		display: grid;
		gap: var(--sp-5);
	}
	.opt + .opt {
		border-top: 1px solid var(--line);
		padding-top: var(--sp-8);
	}
	.small {
		font-size: var(--fs-sm);
	}
	.acts {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	select,
	input {
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-size: var(--fs-base);
	}
	/* The primary action stays reachable on a phone while the page scrolls. */
	@media (max-width: 899px) {
		#use {
			scroll-margin-top: 80px;
		}
		.top {
			position: sticky;
			top: 0;
			z-index: 5;
			background: var(--paper);
			padding: var(--sp-4) 0;
			align-items: center;
			border-bottom: 1px solid var(--line);
		}
		.top .kicker,
		.top p {
			display: none;
		}
		.top h1 {
			font-size: var(--fs-lg);
		}
	}
	@media (min-width: 900px) {
		.cols {
			grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr);
		}
		/* The primary action sits next to the button that leads to it. */
		#use {
			order: -2;
		}
		.side > :global([role='alert']),
		.side > :global([role='status']) {
			order: -1;
		}
		.stagebox {
			height: min(70vh, 680px);
			position: sticky;
			top: 12px;
		}
	}
</style>
