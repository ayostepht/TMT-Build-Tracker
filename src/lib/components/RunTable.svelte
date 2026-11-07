<script lang="ts">
	import type { PrintRun } from '#lib/domain/types.ts';

	let {
		runs,
		colorOf,
		scopeOf,
		canEdit,
		ondelete,
		onedit
	}: {
		runs: PrintRun[];
		/** When set, adds a Color column showing this label for each run. */
		colorOf?: (r: PrintRun) => string;
		/** When set, a small muted tag before the note (e.g. "Plate 7 · whole plate"); empty = none. Grams then read as plate totals. */
		scopeOf?: (r: PrintRun) => string;
		canEdit: boolean;
		ondelete: (r: PrintRun) => void;
		/** When set, editors get an Edit button per row. */
		onedit?: (r: PrintRun) => void;
	} = $props();
</script>

<div class="logscroll">
	<table class="log">
		<thead>
			<tr>
				<th>Date</th><th>Result</th>
				{#if colorOf}<th>Color</th>{/if}
				<th>g</th><th>hrs</th><th>Note</th><th><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each runs as r (r.id)}
				<tr>
					<td class="num">{r.date}</td>
					<td>{r.result}</td>
					{#if colorOf}<td>{colorOf(r)}</td>{/if}
					<td class="num" title={scopeOf?.(r) ? 'plate total' : undefined}>{r.grams ?? ''}</td>
					<td class="num">{r.hours ?? ''}</td>
					<td
						>{#if scopeOf?.(r)}<small class="scope">{scopeOf(r)}</small>{/if}{r.note}{r.userName
							? ` (${r.userName})`
							: ''}</td
					>
					<td>
						{#if canEdit}
							{#if onedit}
								<button
									class="btn sm"
									type="button"
									aria-label="Edit entry"
									onclick={() => onedit(r)}>Edit</button
								>
							{/if}
							<button class="x" type="button" aria-label="Delete entry" onclick={() => ondelete(r)}
								>×</button
							>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scope {
		display: block;
		color: var(--muted);
	}
</style>
