<script lang="ts">
	import { resolve } from '$app/paths';
	import { setAssemblyItem, guidePageImageUrl } from '#lib/client/api.ts';
	import {
		assemblyProgress,
		checkItemKey,
		hwItemKey,
		readyToAssemble,
		stepProgress
	} from '#lib/domain/index.ts';
	import type { AssemblyStep } from '#lib/domain/types.ts';
	import { ago, getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import PhotoGallery from '#lib/components/PhotoGallery.svelte';

	const ctx = getBuildCtx();
	const view = $derived(ctx.view);
	const prog = $derived(assemblyProgress(view));
	const ready = $derived(readyToAssemble(view));
	const partName = (slug: string) => view.parts.find((p) => p.slug === slug)?.name ?? slug;
	const statusOf = (slug: string) => view.state[slug]?.status ?? 'To print';
	const guideImage = (page: number | null) =>
		page !== null && view.guidePages.some((g) => g.page === page && g.hasImage)
			? guidePageImageUrl(view.build.templateId, page)
			: null;

	const sections = $derived.by(() => {
		const out: { name: string; steps: { step: AssemblyStep; n: number }[] }[] = [];
		view.assembly.steps.forEach((step, i) => {
			let s = out[out.length - 1];
			if (!s || s.name !== step.section) {
				s = { name: step.section, steps: [] };
				out.push(s);
			}
			s.steps.push({ step, n: i + 1 });
		});
		return out;
	});

	const set = (key: string, patch: { done?: boolean; note?: string }) =>
		ctx.act(() => setAssemblyItem(ctx.id, key, patch));
	const item = (key: string) => view.assembly.items[key];
</script>

<section class="stack asm">
	<div class="card sum" aria-labelledby="readyTitle">
		<div class="sum-top">
			<h2 id="readyTitle">Ready to assemble</h2>
			<span class="verdict" class:ok={ready.ready} class:warn={!ready.ready}>
				{ready.ready ? 'All parts printed' : `${ready.printed} of ${ready.total} parts printed`}
			</span>
		</div>
		{#if !ready.ready}
			<p class="muted">
				You can start with the steps whose parts are done.
				<a href={resolve('/(app)/builds/[id]/parts', { id: ctx.id })}>Open the Parts tab</a> to finish
				printing:
			</p>
			<ul class="missing">
				{#each ready.missing.slice(0, 8) as p (p.slug)}
					<li>{p.name} isn't printed yet <span class="muted">({statusOf(p.slug)})</span></li>
				{/each}
				{#if ready.missing.length > 8}<li class="muted">
						and {ready.missing.length - 8} more
					</li>{/if}
			</ul>
		{/if}
		<div class="prog">
			<div
				class="bar"
				role="progressbar"
				aria-label="Assembly steps done"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={prog.percent}
			>
				<span style="width:{prog.percent}%;background:var(--ok)"></span>
			</div>
			<b class="num" data-testid="asm-progress">{prog.done} of {prog.total} steps done</b>
		</div>
	</div>

	{#each sections as sec (sec.name)}
		<div class="sec">
			<h2 class="sect-h">{sec.name}</h2>
			{#each sec.steps as { step, n } (step.key)}
				{@const sp = stepProgress(view, step)}
				{@const si = item(step.key)}
				{@const img = guideImage(step.guidePage)}
				<article class="astep" class:done={sp.done} data-step={step.key} data-done={sp.done}>
					<header>
						<span class="no" aria-hidden="true">{sp.done ? '✓' : n}</span>
						<h3>{step.title}</h3>
						{#if step.guidePage !== null}
							<button
								type="button"
								class="gbtn guide"
								class:withimg={!!img}
								aria-label="Open guide page {step.guidePage}"
								onclick={() => ctx.openGuidePage(step.guidePage!)}
							>
								{#if img}<img src={img} alt="" loading="lazy" />{/if}
								<span>Guide p{step.guidePage}</span>
							</button>
						{/if}
					</header>
					<p class="desc">{step.description}</p>

					{#if step.parts.length}
						<div class="blk">
							<div class="lab">Parts</div>
							<ul class="parts">
								{#each step.parts as slug (slug)}
									{@const st = statusOf(slug)}
									<li class:warn={st !== 'Printed'}>
										<span>{partName(slug)}</span>
										{#if st === 'Printed'}
											<span class="pst ok">Printed</span>
										{:else}
											<span class="pst warnchip">{st}</span>
											<span class="warntext">{partName(slug)} isn't printed yet</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if step.hardware.length}
						<div class="blk">
							<div class="lab">Hardware</div>
							<ul class="ticks">
								{#each step.hardware as h (h.name)}
									<li>
										<label>
											<input
												type="checkbox"
												checked={item(hwItemKey(step.key, h.name))?.done ?? false}
												disabled={!ctx.canEdit}
												onchange={(e) =>
													set(hwItemKey(step.key, h.name), { done: e.currentTarget.checked })}
											/>
											<span>{h.name}{h.qty ? ` × ${h.qty}` : ''}</span>
										</label>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if step.checks.length}
						<div class="blk">
							<div class="lab">Checks</div>
							<ul class="ticks">
								{#each step.checks as c (c.key)}
									{@const ci = item(checkItemKey(step.key, c.key))}
									<li>
										<label>
											<input
												type="checkbox"
												checked={ci?.done ?? false}
												disabled={!ctx.canEdit}
												onchange={(e) =>
													set(checkItemKey(step.key, c.key), { done: e.currentTarget.checked })}
											/>
											<span>{c.text}</span>
										</label>
										{#if ci?.done && ci.doneByName}
											<span class="who">{ci.doneByName}</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<label class="note">
						<span class="lab">Notes</span>
						<textarea
							rows="2"
							placeholder={ctx.canEdit ? 'Anything to remember about this step' : ''}
							value={si?.note ?? ''}
							readonly={!ctx.canEdit}
							onchange={(e) => set(step.key, { note: e.currentTarget.value })}></textarea>
					</label>

					<footer>
						{#if sp.done}
							<span class="doneby"
								>Done{si?.doneByName ? ` by ${si.doneByName}` : ''}{si?.doneAt
									? ` · ${ago(si.doneAt, ctx.now)}`
									: ''}</span
							>
						{/if}
						{#if ctx.canEdit}
							{#if sp.done}
								<button type="button" class="btn sm" onclick={() => set(step.key, { done: false })}
									>Reopen step</button
								>
							{:else}
								<button
									type="button"
									class="btn primary"
									onclick={() => set(step.key, { done: true })}>Mark step done</button
								>
							{/if}
						{/if}
					</footer>
				</article>
			{/each}
		</div>
	{:else}
		<p class="muted">This kit has no assembly checklist yet.</p>
	{/each}

	<div class="card">
		<h2>Progress photos</h2>
		<PhotoGallery
			kinds={['progress']}
			uploadKind="progress"
			label="progress photo"
			emptyText="No progress photos yet. Add some as the chair comes together."
		/>
	</div>
</section>

<style>
	.asm {
		display: grid;
		gap: 14px;
	}
	.sum-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}
	.verdict.warn {
		background: var(--warn-soft);
		color: var(--warn);
	}
	.missing {
		margin: 6px 0 10px;
		padding-left: 18px;
		color: var(--warn);
		font-size: 14px;
	}
	.prog {
		display: grid;
		gap: 6px;
		margin-top: 8px;
	}
	.sec {
		display: grid;
		gap: 10px;
	}
	.astep {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px 14px;
		display: grid;
		gap: 10px;
	}
	.astep.done {
		border-color: var(--ok);
		background: color-mix(in srgb, var(--ok-soft) 45%, var(--card));
	}
	.astep header {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.astep h3 {
		flex: 1;
		min-width: 0;
		margin: 0;
	}
	.no {
		flex: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		color: var(--accent);
		font: 600 14px var(--f-mono);
	}
	.done .no {
		background: var(--ok);
		color: #fff;
	}
	.desc {
		margin: 0;
		color: var(--ink);
	}
	.guide {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
	}
	.guide.withimg img {
		width: 44px;
		height: 56px;
		object-fit: cover;
		object-position: top;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: #fff;
	}
	.lab {
		font: 600 12px var(--f-body);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
		margin-bottom: 4px;
	}
	.parts,
	.ticks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.parts li {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.warntext {
		color: var(--warn);
		font-size: 13px;
	}
	.pst {
		font: 600 11px var(--f-body);
		padding: 2px 8px;
		border-radius: 999px;
		line-height: 1.5;
	}
	.pst.ok {
		background: var(--ok-soft);
		color: var(--ok);
		border-color: transparent;
	}
	.pst.warnchip {
		background: var(--warn-soft);
		color: var(--warn);
		border-color: transparent;
	}
	.ticks label {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		min-height: 32px;
		cursor: pointer;
	}
	.ticks input {
		width: 20px;
		height: 20px;
		margin-top: 1px;
		flex: none;
	}
	.ticks li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		justify-content: space-between;
	}
	.who {
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.note {
		display: grid;
		gap: 2px;
	}
	.note textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		resize: vertical;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}
	.doneby {
		margin-right: auto;
		color: var(--ok);
		font-size: 13px;
	}
	@media (max-width: 520px) {
		footer .btn.primary {
			flex: 1;
			padding: 12px 14px;
		}
	}
</style>
