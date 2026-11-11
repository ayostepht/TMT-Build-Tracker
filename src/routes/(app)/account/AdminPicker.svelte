<script lang="ts">
	import { enhance } from '$app/forms';
	import { searchAccounts, type FoundAccount as Found } from '#lib/client/api.ts';
	let { error = '' }: { error?: string } = $props();

	let q = $state('');
	let users = $state<Found[]>([]);
	let loaded = $state(false);
	let failed = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	async function search() {
		const mine = ++seq;
		try {
			const found = await searchAccounts(q);
			if (mine !== seq) return;
			users = found;
			failed = '';
		} catch (e) {
			failed = (e as Error).message;
		}
		loaded = true;
	}

	function typing() {
		clearTimeout(timer);
		timer = setTimeout(search, 200);
	}

	$effect(() => {
		void search();
		return () => clearTimeout(timer);
	});
</script>

<div class="pick">
	<label class="field"
		>Find an account
		<input
			type="search"
			bind:value={q}
			oninput={typing}
			placeholder="Name or email"
			autocomplete="off"
			data-testid="admin-search"
		/></label
	>
	{#if error}<div class="error" role="alert" data-testid="admin-error">{error}</div>{/if}
	{#if failed}<div class="error" role="alert">{failed}</div>{/if}
	<ul class="pick-list" data-testid="admin-candidates">
		{#each users as u (u.id)}
			<li class="pick-row">
				<span class="pick-who"><b>{u.name}</b> <span class="muted">{u.email}</span></span>
				{#if u.isAdmin}
					<span class="muted">Site admin</span>
				{:else if !u.canGrant}
					<span class="muted">Email not verified</span>
				{:else}
					<form
						method="post"
						action="?/grant"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								await search();
							}}
					>
						<input type="hidden" name="userId" value={u.id} />
						<button class="btn sm primary" data-testid="make-admin">Make site admin</button>
					</form>
				{/if}
			</li>
		{:else}
			{#if loaded}<li class="muted">No other accounts match.</li>{/if}
		{/each}
	</ul>
</div>

<style>
	.pick {
		display: grid;
		gap: 10px;
	}
	.pick input {
		font-size: 16px;
	}
	.pick-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
		max-height: 260px;
		overflow: auto;
	}
	.pick-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
		font-size: 14px;
	}
	.pick-who {
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
