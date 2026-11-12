<script lang="ts">
	import AskDialog from '#lib/components/AskDialog.svelte';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { markHandedOff, saveHandoff, setAssemblyItem, updateBuild } from '#lib/client/api.ts';
	import { assemblyProgress, checkItemKey, isDone, safetyComplete } from '#lib/domain/index.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PhotoGallery from '#lib/components/PhotoGallery.svelte';

	const ctx = getBuildCtx();
	const view = $derived(ctx.view);
	const h = $derived(view.handoff);
	const handedOff = $derived(view.build.phase === 'done');

	function initial() {
		const v = ctx.view;
		return {
			recipientName: v.handoff?.recipientName ?? v.build.recipient ?? '',
			organization: v.handoff?.organization ?? v.build.hospital ?? '',
			contact: v.handoff?.contact ?? '',
			handedOffOn: v.handoff?.handedOffOn ?? '',
			location: v.handoff?.location ?? '',
			notes: v.handoff?.notes ?? ''
		};
	}
	let form = $state(untrack(initial));
	let dirty = $state(false);
	let saved = $state(false);

	// Someone else saved: show their values unless this person is mid-edit.
	let seen = untrack(() => ctx.view.handoff?.updatedAt ?? null);
	$effect(() => {
		const at = h?.updatedAt ?? null;
		if (at === seen) return;
		seen = at;
		if (!dirty) form = initial();
	});

	const body = () => ({
		recipientName: form.recipientName || null,
		organization: form.organization || null,
		contact: form.contact || null,
		handedOffOn: form.handedOffOn || null,
		location: form.location || null,
		notes: form.notes
	});

	async function save() {
		saved = false;
		if (await ctx.act(() => saveHandoff(ctx.id, body()))) {
			dirty = false;
			saved = true;
		}
	}

	const prog = $derived(assemblyProgress(view));
	const safety = $derived(view.assembly.steps.find((s) => s.safety));
	const safetyOk = $derived(safetyComplete(view));
	const problems = $derived(
		[
			prog.done < prog.total ? `${prog.total - prog.done} assembly step(s) are not done` : '',
			safety && !safetyOk ? 'Not every safety check is ticked' : '',
			!h?.safetyChecked ? 'The safety sign-off is not confirmed' : ''
		].filter(Boolean)
	);

	async function complete() {
		if (
			problems.length &&
			!(await asking.ask(`${problems.join('. ')}.\n\nMark as handed off anyway?`, {
				title: 'Hand off anyway?',
				confirmLabel: 'Mark as handed off'
			}))
		)
			return;
		if (await ctx.act(() => markHandedOff(ctx.id, body()))) dirty = false;
	}
	const reopen = () => ctx.act(() => updateBuild(ctx.id, { phase: 'handoff' }));
	const touch = () => ((dirty = true), (saved = false));
	const asking = createAsk();
</script>

<AskDialog ask={asking} />
<section class="stack ho">
	{#if handedOff}
		<div class="card donecard" role="status">
			<h2>Handed off</h2>
			<p>
				{view.build.name} went to {h?.organization ||
					h?.recipientName ||
					'its recipient'}{h?.handedOffOn ? ` on ${h.handedOffOn}` : ''}.
			</p>
			<div class="row2">
				<a class="btn primary" href={resolve('/(app)/builds/[id]/summary', { id: ctx.id })}
					>Open the build summary</a
				>
				{#if ctx.canEdit}<button type="button" class="btn" onclick={reopen}>Reopen handoff</button
					>{/if}
			</div>
		</div>
	{/if}

	<form
		class="card"
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<h2>Recipient</h2>
		<div class="form-grid">
			<label class="field"
				>Recipient name
				<input bind:value={form.recipientName} oninput={touch} disabled={!ctx.canEdit} /></label
			>
			<label class="field"
				>Organization or hospital
				<input bind:value={form.organization} oninput={touch} disabled={!ctx.canEdit} /></label
			>
			<label class="field"
				>Contact (chapter members only)
				<input
					bind:value={form.contact}
					oninput={touch}
					disabled={!ctx.canEdit}
					placeholder="Email or phone, kept off the summary"
				/></label
			>
			<label class="field"
				>Handed off on
				<input
					type="date"
					bind:value={form.handedOffOn}
					oninput={touch}
					disabled={!ctx.canEdit}
				/></label
			>
			<label class="field span2"
				>Location
				<input bind:value={form.location} oninput={touch} disabled={!ctx.canEdit} /></label
			>
			<label class="field span2"
				>Notes (fitting, adjustments, follow-up)
				<textarea rows="3" bind:value={form.notes} oninput={touch} disabled={!ctx.canEdit}
				></textarea></label
			>
		</div>
		{#if ctx.canEdit}
			<div class="row2">
				<button class="btn" type="submit" disabled={!dirty}>Save details</button>
				{#if saved}<span class="muted" role="status">Saved</span>{/if}
			</div>
		{/if}
	</form>

	<div class="card">
		<h2>Safety checks</h2>
		{#if safety}
			<p class="muted">The same checks as the last Assembly step. Tick them here or there.</p>
			<ul class="ticks">
				{#each safety.checks as c (c.key)}
					{@const k = checkItemKey(safety.key, c.key)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={isDone(view, k)}
								disabled={!ctx.canEdit}
								onchange={(e) =>
									ctx.act(() => setAssemblyItem(ctx.id, k, { done: e.currentTarget.checked }))}
							/>
							<span>{c.text}</span>
						</label>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">This kit has no safety checklist.</p>
		{/if}
		<label class="signoff">
			<input
				type="checkbox"
				checked={h?.safetyChecked ?? false}
				disabled={!ctx.canEdit}
				onchange={(e) =>
					ctx.act(() => saveHandoff(ctx.id, { safetyChecked: e.currentTarget.checked }))}
			/>
			<span>I went through the safety checks with this chair in my hands</span>
		</label>
	</div>

	<div class="card">
		<h2>Finished chair</h2>
		<PhotoGallery
			kinds={['finished']}
			uploadKind="finished"
			label="finished-chair photo"
			emptyText="No photos of the finished chair yet."
		/>
	</div>

	<div class="card">
		<h2>At the handoff</h2>
		<PhotoGallery
			kinds={['handoff']}
			uploadKind="handoff"
			label="handoff photo"
			emptyText="Photos from the handoff day show up here."
		/>
	</div>

	{#if !handedOff}
		<div class="card">
			<h2>Hand it over</h2>
			{#if problems.length}
				<ul class="problems">
					{#each problems as p (p)}<li>{p}</li>{/each}
				</ul>
			{:else}
				<p class="muted">Everything is checked. Marking it handed off moves the build to Done.</p>
			{/if}
			<div class="row2">
				{#if ctx.canEdit}
					<button type="button" class="btn primary" onclick={complete}>Mark as handed off</button>
				{/if}
				<a class="btn" href={resolve('/(app)/builds/[id]/summary', { id: ctx.id })}>Build summary</a
				>
			</div>
		</div>
	{/if}
</section>

<style>
	.ho {
		display: grid;
		gap: 14px;
	}
	.row2 {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 8px;
	}
	.donecard {
		border-color: var(--ok);
		background: color-mix(in srgb, var(--ok-soft) 45%, var(--card));
	}
	.ticks {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.ticks label,
	.signoff {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		cursor: pointer;
	}
	.ticks input,
	.signoff input {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.signoff {
		font-weight: 500;
	}
	.problems {
		color: var(--warn);
		padding-left: 18px;
		margin: 6px 0 10px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 9px 10px;
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		resize: vertical;
	}
	@media (max-width: 760px) {
		.row2 .btn.primary {
			flex: 1;
		}
	}
</style>
