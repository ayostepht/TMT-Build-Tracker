<script lang="ts">
	import { resolve } from '$app/paths';
	import { photoUrl } from '#lib/client/api.ts';
	import {
		assemblyProgress,
		checkItemKey,
		filamentStats,
		fmt,
		fmtH,
		isDone,
		timeStats
	} from '#lib/domain/index.ts';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	const ctx = getBuildCtx();
	const view = $derived(ctx.view);
	const b = $derived(view.build);
	const h = $derived(view.handoff);
	const recipient = $derived(h?.recipientName ?? b.recipient);
	const organization = $derived(h?.organization ?? b.hospital);
	const stats = $derived(filamentStats(view));
	const time = $derived(timeStats(view));
	const prog = $derived(assemblyProgress(view));
	const safety = $derived(view.assembly.steps.find((s) => s.safety));
	const platesPrinted = $derived(
		view.plates.filter((p) => p.parts.every((s) => view.state[s]?.status === 'Printed')).length
	);
	const partsPrinted = $derived(
		view.parts.filter((p) => view.state[p.slug]?.status === 'Printed').length
	);
	const variants = $derived(
		view.variantGroups.map((g) => ({
			group: g.name,
			option: g.options.find((o) => o.key === view.variantChoices[g.key])?.name ?? ''
		}))
	);
	const makers = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const r of view.runs) {
			if (r.result !== 'Success' || !r.userName) continue;
			m[r.userName] = (m[r.userName] ?? 0) + 1;
		}
		return Object.entries(m).sort((a, c) => c[1] - a[1]);
	});
	const photos = $derived(view.photos.filter((p) => p.kind === 'finished' || p.kind === 'handoff'));
	const totalGrams = $derived(stats.reduce((a, s) => a + s.used, 0));
</script>

<svelte:head><title>Build summary · {b.name}</title></svelte:head>

<article class="summary">
	<div class="no-print bar-actions">
		<a class="btn ghost sm back" href={resolve('/(app)/builds/[id]/finish', { id: ctx.id })}
			><span class="btn-arrow" aria-hidden="true">←</span> Finish</a
		>
		<button type="button" class="btn primary" onclick={() => window.print()}
			>Print / Save as PDF</button
		>
	</div>

	<header class="sh">
		<div class="kicker">{b.templateName} · build summary</div>
		<h1>{b.name}</h1>
		<dl class="facts">
			{#if recipient}<div>
					<dt>Recipient</dt>
					<dd>{recipient}</dd>
				</div>{/if}
			{#if organization}<div>
					<dt>Organization</dt>
					<dd>{organization}</dd>
				</div>{/if}
			{#if h?.handedOffOn}<div>
					<dt>Handed off</dt>
					<dd>{h.handedOffOn}</dd>
				</div>{/if}
			{#if h?.location}<div>
					<dt>Location</dt>
					<dd>{h.location}</dd>
				</div>{/if}
			<div>
				<dt>Started</dt>
				<dd>{b.createdAt.slice(0, 10)}</dd>
			</div>
		</dl>
		{#if h?.notes}<p class="notes">{h.notes}</p>{/if}
	</header>

	<section>
		<h2>Colors and filament</h2>
		<table class="tbl">
			<thead><tr><th>Slot</th><th>Filament</th><th class="r">Used</th></tr></thead>
			<tbody>
				{#each view.filaments as f (f.key)}
					{@const st = stats.find((s) => s.role === f.key)}
					<tr>
						<td>{f.key}</td>
						<td><span class="sw" style="background:{f.hex}"></span> {filamentLabel(f, f.key)}</td>
						<td class="r num">{fmt(Math.round(st?.used ?? 0))} g</td>
					</tr>
				{/each}
			</tbody>
			<tfoot
				><tr><td colspan="2">Total</td><td class="r num">{fmt(Math.round(totalGrams))} g</td></tr
				></tfoot
			>
		</table>
	</section>

	<section>
		<h2>Variants</h2>
		<ul class="plain">
			{#each variants as v (v.group)}<li><b>{v.group}:</b> {v.option}</li>{/each}
		</ul>
	</section>

	<section>
		<h2>Printing</h2>
		<ul class="plain">
			<li><b>{partsPrinted} of {view.parts.length}</b> parts printed</li>
			<li><b>{platesPrinted} of {view.plates.length}</b> plates printed</li>
			<li><b>{fmtH(time.loggedHours * 3600)}</b> of print time logged</li>
			{#if makers.length}
				<li>
					Printed by {makers.map(([n, c]) => `${n} (${c} print${c === 1 ? '' : 's'})`).join(', ')}
				</li>
			{/if}
		</ul>
	</section>

	<section>
		<h2>Assembly</h2>
		<p><b>{prog.done} of {prog.total}</b> steps done</p>
		{#if safety}
			<h3>Safety checks</h3>
			<ul class="checks">
				{#each safety.checks as c (c.key)}
					{@const ok = isDone(view, checkItemKey(safety.key, c.key))}
					<li class:ok><span aria-hidden="true">{ok ? '☑' : '☐'}</span> {c.text}</li>
				{/each}
			</ul>
		{/if}
		<p>Safety sign-off: <b>{h?.safetyChecked ? 'confirmed' : 'not confirmed'}</b></p>
	</section>

	{#if photos.length}
		<section class="photos">
			<h2>Photos</h2>
			<div class="pgrid">
				{#each photos as p (p.id)}
					<img src={photoUrl(ctx.id, p.id)} alt={p.caption || 'Chair photo'} loading="lazy" />
				{/each}
			</div>
		</section>
	{/if}
</article>

<style>
	.summary {
		display: grid;
		gap: 18px;
		max-width: 820px;
	}
	.bar-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 8px 16px;
		margin: 10px 0 0;
	}
	.facts dt {
		font: 600 11px var(--f-body);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
	}
	.notes {
		white-space: pre-wrap;
	}
	h2 {
		margin: 0 0 6px;
	}
	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	.tbl th,
	.tbl td {
		text-align: left;
		padding: 5px 6px;
		border-bottom: 1px solid var(--line);
	}
	.tbl .r {
		text-align: right;
	}
	.tbl tfoot td {
		font-weight: 600;
	}
	.sw {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 1px solid var(--line);
		vertical-align: -1px;
	}
	.plain,
	.checks {
		margin: 0;
		padding-left: 18px;
	}
	.checks {
		list-style: none;
		padding-left: 0;
	}
	.checks li {
		display: flex;
		gap: 8px;
	}
	.pgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 8px;
	}
	.pgrid img {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 6px;
	}
	@media print {
		:global(body:has(.summary)) :global(.topbar),
		:global(body:has(.summary)) :global(.head),
		:global(body:has(.summary)) :global(.tabs),
		:global(body:has(.summary)) :global(.banner),
		:global(body:has(.summary)) :global(.toast),
		.no-print {
			display: none !important;
		}
		:global(body:has(.summary)) {
			background: #fff;
			color: #000;
		}
		.summary {
			max-width: none;
			gap: 12px;
		}
		section {
			break-inside: avoid;
		}
		.pgrid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
