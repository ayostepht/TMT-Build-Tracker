<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<section class="stack">
	<div class="kicker">Site admin</div>
	<h1>Kits</h1>
	<p class="muted">
		Templates installed on this server. Model import and placement editing will appear here.
	</p>
	<ul class="tpl-list">
		{#each data.templates as t (t.id)}
			<li class="tpl">
				<h3>{t.name}</h3>
				<div class="muted">{t.version}</div>
				<div class="counts">
					<span class="set">{t.parts} parts</span>
					<span class="set">{t.plates} plates</span>
					<span class="set">{t.variantGroups} variant groups</span>
					<span class="set">
						{t.model ? `3D model v${t.model.version.slice(0, 8)}` : 'No 3D model yet'}
					</span>
				</div>
			</li>
		{/each}
	</ul>
</section>
