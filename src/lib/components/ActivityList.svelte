<script lang="ts">
	import { resolve } from '$app/paths';
	import { describeActivitySegments } from '#lib/domain/activity.ts';
	import { getBuildCtx, ago } from './build-context.svelte.ts';

	// limit: entries shown (the server loads at most 50). heading: null hides the heading
	// (the Activity tab already says "Activity").
	let { limit = 12, heading = 'Recent activity' }: { limit?: number; heading?: string | null } =
		$props();

	const ctx = getBuildCtx();
	const shown = $derived(ctx.view.activity.slice(0, limit));
	// The view is capped server-side, so a full list may have older entries we never loaded.
	const truncated = $derived(ctx.view.activity.length >= 50 && limit >= 50);

	// Links go to this build's Print tab; the Print tab reads the hash (#plate-N / #part-slug).
	const printUrl = $derived(resolve('/(app)/builds/[id]/print', { id: ctx.id }));
</script>

<section
	aria-labelledby={heading ? 'actTitle' : undefined}
	aria-label={heading ? undefined : 'Activity'}
	style="display:grid;gap:var(--sp-5)"
>
	{#if heading}<h2 id="actTitle">{heading}</h2>{/if}
	{#if ctx.view.activity.length}
		<ul class="activity">
			{#each shown as a (a.id)}
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
		{#if truncated}
			<p class="empty" data-testid="activity-truncated">
				Showing the last {ctx.view.activity.length} changes. Older changes aren't shown.
			</p>
		{/if}
	{:else}
		<p class="empty">Nothing yet. Changes on this build show up here.</p>
	{/if}
</section>
