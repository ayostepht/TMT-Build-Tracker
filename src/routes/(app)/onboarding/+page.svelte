<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<section class="stack">
	<div class="kicker">Chapters</div>
	<h1>Build with others</h1>
	<p class="muted">
		A chapter is a team of makers who share builds, progress and filament. Your own builds stay in
		My builds until you move them to a chapter.
	</p>

	{#if data.invitations.length}
		<div class="card stack">
			<h2>Invitations for you</h2>
			{#each data.invitations as i (i.id)}
				<div>
					<b>{i.team}</b> invited you as {i.role} (from {i.inviter}).
					<a class="btn primary" href={resolve('/invite/[id]', { id: i.id })}>View invitation</a>
				</div>
			{/each}
		</div>
	{/if}

	<form class="card stack" method="post" action="?/create" use:enhance>
		<h2>Create a chapter</h2>
		{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}
		<label class="field">Chapter name<input name="name" required maxlength="80" /></label>
		<button class="btn primary">Create chapter</button>
	</form>

	<p><a href={resolve('/(app)')}>Back to my builds</a></p>
</section>
