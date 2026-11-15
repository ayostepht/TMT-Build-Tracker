<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ActivityList from '#lib/components/ActivityList.svelte';

	const ctx = getBuildCtx();
</script>

<svelte:head><title>Activity · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<ActivityList limit={50} heading={null} />
