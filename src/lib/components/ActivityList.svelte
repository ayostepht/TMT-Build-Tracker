<script lang="ts">
	import { resolve } from '$app/paths';
	import { describeActivitySegments } from '#lib/domain/activity.ts';
	import { getBuildCtx, ago } from './build-context.svelte.ts';

	const ctx = getBuildCtx();

	// Links go to this build's Print tab; the Print tab reads the hash (#plate-N / #part-slug).
	const printUrl = $derived(resolve('/(app)/builds/[id]/print', { id: ctx.id }));
</script>

<section aria-labelledby="actTitle" style="display:grid;gap:10px">
	<h2 id="actTitle">Recent activity</h2>
	{#if ctx.view.activity.length}
		<ul class="activity">
			{#each ctx.view.activity.slice(0, 12) as a (a.id)}
				<li>
					<span
						>{#each describeActivitySegments(a, ctx.view) as s, i (i)}{#if s.plate !== undefined}<a
									class="alink"
									href="{printUrl}#plate-{s.plate}">{s.text}</a
								>{:else if s.part}<a class="alink" href="{printUrl}#part-{s.part}">{s.text}</a
								>{:else}{s.text}{/if}{/each}</span
					><time datetime={a.at}>{ago(a.at, ctx.now)}</time>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">Nothing yet. Changes on this build show up here.</p>
	{/if}
</section>
