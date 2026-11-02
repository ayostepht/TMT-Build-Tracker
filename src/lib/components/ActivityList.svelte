<script lang="ts">
	import { describeActivity } from '#lib/domain/activity.ts';
	import { getBuildCtx, ago } from './build-context.svelte.ts';

	const ctx = getBuildCtx();
</script>

<section aria-labelledby="actTitle" style="display:grid;gap:10px">
	<h2 id="actTitle">Recent activity</h2>
	{#if ctx.view.activity.length}
		<ul class="activity">
			{#each ctx.view.activity.slice(0, 12) as a (a.id)}
				<li>
					<span>{describeActivity(a, ctx.view)}</span><time datetime={a.at}
						>{ago(a.at, ctx.now)}</time
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">Nothing yet. Changes by your team show up here.</p>
	{/if}
</section>
