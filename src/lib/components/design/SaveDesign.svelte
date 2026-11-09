<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { createDesign, uploadDesignSnapshot } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	let { snapshot }: { snapshot?: () => Promise<Blob> } = $props();

	const ctx = getBuildCtx();
	let name = $state('');
	let isPublic = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let saved = $state<{ slug: string; name: string; isPublic: boolean } | null>(null);
	let copied = $state(false);

	const url = $derived(saved ? `${page.url.origin}/designs/${saved.slug}` : '');

	async function save() {
		error = null;
		if (!name.trim()) {
			error = 'Give the design a name.';
			return;
		}
		busy = true;
		try {
			const d = await createDesign({ buildId: ctx.id, name: name.trim(), isPublic });
			saved = { slug: d.slug, name: name.trim(), isPublic };
			if (snapshot) {
				try {
					await uploadDesignSnapshot(d.id, await snapshot());
				} catch {
					/* the preview is optional; the design is saved without it */
				}
			}
			name = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'That did not save.';
		} finally {
			busy = false;
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* the field is selectable as a fallback */
		}
	}
</script>

<section class="save" aria-label="Share or save as design">
	<p class="muted">
		Your changes to this build are already saved. Save a copy of the colors as a design to reuse on
		another build, or share its link with other makers.
	</p>
	{#if ctx.canEdit}
		<form
			class="stack"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label class="field">
				Design name
				<input bind:value={name} maxlength="100" placeholder="e.g. Ocean blues" />
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={isPublic} />
				Share publicly (anyone signed in to this server can find it in Designs)
			</label>
			{#if error}<div class="error" role="alert">{error}</div>{/if}
			<button class="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save design'}</button>
		</form>
	{:else}
		<p class="muted">You have view-only access, so you cannot save designs from this build.</p>
	{/if}
	{#if saved}
		<div class="done" role="status" data-testid="design-saved">
			<b>Saved "{saved.name}".</b>
			{saved.isPublic
				? 'It is public.'
				: 'Only you and people in your chapters can open this link.'}
			<div class="link">
				<input
					readonly
					value={url}
					aria-label="Design link"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button type="button" class="btn sm" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
			</div>
			<a href={resolve('/(app)/designs/[slug]', { slug: saved.slug })}>Open design page</a>
		</div>
	{/if}
</section>

<style>
	.check {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 14px;
	}
	.save {
		display: grid;
		gap: 12px;
	}
	p {
		margin: 0;
	}
	.done {
		display: grid;
		gap: 6px;
		background: var(--ok-soft);
		border-radius: 8px;
		padding: 10px 12px;
	}
	.link {
		display: flex;
		gap: 8px;
	}
	.link input {
		flex: 1;
		min-width: 0;
		padding: 7px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
		font: 13px var(--f-mono);
	}
</style>
