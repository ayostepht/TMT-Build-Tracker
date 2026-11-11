<script lang="ts">
	import { page } from '$app/state';
	import ErrorPage from '#lib/components/ErrorPage.svelte';
</script>

<!-- Inside the app shell: the top bar stays, so a wrong link never strands the user. -->
<ErrorPage status={page.status} signedIn />
