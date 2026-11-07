<script lang="ts">
	import type { Plate } from '#lib/domain/types.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import LogRunSheet from './LogRunSheet.svelte';

	/**
	 * "Log plate N printed…": opens the log sheet for a whole plate with Success preselected, the
	 * time and grams prefilled, so a finished plate is one tap plus Save. Editors only.
	 */
	let {
		plate,
		label = 'Log plate printed…',
		first = null,
		primary = false
	}: { plate: Plate; label?: string; primary?: boolean; first?: string | null } = $props();
	const ctx = getBuildCtx();
	let open = $state(false);

	const status = (s: string) => ctx.view.state[s]?.status;
	const unprinted = $derived(plate.parts.filter((s) => status(s) !== 'Printed'));
	// What the log covers: the parts on the printer when any are, else every part still to do.
	const slugs = $derived.by(() => {
		if (plate.perPartRuns)
			return first && unprinted.includes(first)
				? [first, ...unprinted.filter((s) => s !== first)]
				: unprinted;
		const on = unprinted.filter((s) => status(s) === 'Printing');
		return on.length ? on : unprinted;
	});
	const startedAt = $derived(
		plate.parts
			.map((s) => (status(s) === 'Printing' ? ctx.view.state[s].startedAt : null))
			.filter((s): s is string => !!s)
			.sort()[0] ?? null
	);
</script>

{#if ctx.canEdit && slugs.length}
	<button
		class="btn sm"
		class:primary
		type="button"
		aria-label="Log plate {plate.number} printed"
		onclick={() => (open = true)}>{label}</button
	>
	<LogRunSheet
		bind:open
		quick
		plateNumber={plate.number}
		{slugs}
		{startedAt}
		title="Log plate {plate.number} printed"
	/>
{/if}
