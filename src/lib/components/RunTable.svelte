<script lang="ts">
	import type { PrintRun } from '#lib/domain/types.ts';

	let {
		runs,
		colorOf,
		canEdit,
		ondelete
	}: {
		runs: PrintRun[];
		/** When set, adds a Color column showing this label for each run. */
		colorOf?: (r: PrintRun) => string;
		canEdit: boolean;
		ondelete: (r: PrintRun) => void;
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
					<td class="num">{r.grams ?? ''}</td>
					<td class="num">{r.hours ?? ''}</td>
					<td>{r.note}{r.userName ? ` (${r.userName})` : ''}</td>
					<td>
						{#if canEdit}
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
