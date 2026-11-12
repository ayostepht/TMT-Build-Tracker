<script lang="ts">
	import TeamIntegrations from '#lib/components/TeamIntegrations.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Integrations · {data.team.name}</title></svelte:head>

<TeamIntegrations orgId={data.team.id} hosted={data.hosted} />
