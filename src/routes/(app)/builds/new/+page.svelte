<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// svelte-ignore state_referenced_locally
	let workspaceId = $state(data.workspaceId ?? '');
</script>

<svelte:head><title>New build · TMT Build Tracker</title></svelte:head>

<section class="stack narrow">
	<div class="kicker">New build</div>
	<h1>Start a new build</h1>
	<p class="muted">Name it now. Next you choose the files, options, colors and printer.</p>
	{#if !data.workspaces.length}
		<div class="banner" role="note">
			You have view-only access everywhere, so you cannot start a build.
		</div>
	{:else}
		<form class="card stack" method="post" use:enhance>
			{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}
			<label class="field">Name<input name="name" required maxlength="200" /></label>
			<label class="field">Recipient (optional)<input name="recipient" /></label>
			<label class="field">Hospital (optional)<input name="hospital" /></label>
			{#if data.workspaces.length > 1}
				<label class="field"
					>Create in
					<select name="organizationId" bind:value={workspaceId}>
						{#each data.workspaces as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				</label>
			{:else}
				<input type="hidden" name="organizationId" value={workspaceId} />
			{/if}
			<div><button class="btn primary">Create build</button></div>
		</form>
	{/if}
</section>
