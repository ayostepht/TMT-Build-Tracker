<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import { CHART_CTX } from './tones.ts';

	/**
	 * Card around one chart: a heading, a one-sentence summary (the figcaption; the chart's <svg> is
	 * labelled by both) and a "Show data" disclosure holding a real table of the numbers. Charts go
	 * in `children`. Renders a .ds-card.
	 */
	let {
		title,
		summary,
		table,
		children
	}: {
		title: string;
		summary: string;
		table: { columns: string[]; rows: (string | number)[][] };
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-t`;
	const sumId = `${uid}-s`;
	setContext(CHART_CTX, { labelledby: `${titleId} ${sumId}` });
</script>

<figure class="ds-card cf-fig">
	<figcaption class="cf-cap">
		<h3 id={titleId} class="cf-title">{title}</h3>
		<p id={sumId} class="cf-sum">{summary}</p>
	</figcaption>
	<div class="cf-body">{@render children()}</div>
	<details class="cf-data">
		<summary>Show data</summary>
		<!-- a scrollable region must be keyboard reachable -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="cf-scroll" role="region" aria-label="{title}, data table" tabindex="0">
			<table class="cf-table">
				<caption class="cf-sr">{title}</caption>
				<thead>
					<tr>
						{#each table.columns as c, i (i)}
							<th scope="col" class:cf-num={i > 0}>{c}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each table.rows as r, ri (ri)}
						<tr>
							{#each r as cell, ci (ci)}
								{#if ci === 0}
									<th scope="row">{cell}</th>
								{:else}
									<td class="cf-num">{cell}</td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>

<style>
	.cf-fig {
		margin: 0;
		grid-template-columns: minmax(0, 1fr);
	}
	.cf-cap {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
	}
	.cf-title {
		margin: 0;
		font-family: var(--f-display);
		font-size: var(--fs-lg);
		font-weight: 600;
		letter-spacing: 0.2px;
		color: var(--ink);
	}
	.cf-sum {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.cf-body {
		min-width: 0;
		display: grid;
		gap: var(--sp-5);
	}
	.cf-data summary {
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 0 var(--sp-2);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--accent);
		border-radius: var(--r-sm);
	}
	.cf-data summary:focus-visible,
	.cf-scroll:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.cf-data summary {
			min-height: 44px;
		}
	}
	.cf-scroll {
		overflow-x: auto;
		max-width: 100%;
		/* Scrolls sideways inside its own box; the shadow at an edge shows there is more that way. */
		background:
			linear-gradient(to right, var(--card) 30%, transparent) left center / 28px 100% no-repeat
				local,
			linear-gradient(to left, var(--card) 30%, transparent) right center / 28px 100% no-repeat
				local,
			radial-gradient(
					farthest-side at 0 50%,
					color-mix(in srgb, var(--ink) 32%, transparent),
					transparent
				)
				left center / 14px 100% no-repeat scroll,
			radial-gradient(
					farthest-side at 100% 50%,
					color-mix(in srgb, var(--ink) 32%, transparent),
					transparent
				)
				right center / 14px 100% no-repeat scroll;
		overscroll-behavior-x: contain;
		margin-top: var(--sp-4);
	}
	.cf-table {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--fs-sm);
		font-variant-numeric: tabular-nums;
	}
	.cf-table th,
	.cf-table td {
		padding: var(--sp-3) var(--sp-5);
		border-bottom: 1px solid var(--line);
		text-align: left;
		white-space: nowrap;
		color: var(--ink);
	}
	.cf-table thead th {
		color: var(--muted);
		font-weight: 600;
	}
	.cf-table thead th:first-child {
		position: sticky;
		left: 0;
		background: var(--card);
	}
	.cf-table tbody th {
		font-weight: 500;
		/* the row name stays in view while the numbers scroll */
		position: sticky;
		left: 0;
		background: var(--card);
	}
	.cf-table .cf-num {
		text-align: right;
	}
	.cf-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
