<script lang="ts" module>
	export interface PickItem {
		id: string;
		name: string;
		/** Small text on the right (the part's filament, the piece's settings). */
		hint?: string;
	}
</script>

<script lang="ts">
	/**
	 * A small pick sheet, used twice. "Print some parts…" on a plate lists the plate's parts that are
	 * not printed and not on the printer yet; "Print some pieces…" on a part lists the part's pieces
	 * that are not ticked yet. All are ticked by default, with All / None. Confirming marks the ticked
	 * ones as ONE print (the caller does the start); "Log … instead" hands them to the log sheet
	 * without marking them Printing first. All ticked is the same as the whole's own Printing action.
	 *
	 * Ids are strings (a part slug, or a piece index as text). Test ids: `part-pick*` for parts,
	 * `piece-pick*` for pieces (`unit`).
	 */
	let {
		open = $bindable(false),
		title,
		unit = 'part',
		items,
		onprint,
		onlog
	}: {
		open?: boolean;
		title: string;
		unit?: 'part' | 'piece';
		/** What can be picked, in order. */
		items: PickItem[];
		onprint: (picked: string[]) => void;
		onlog: (picked: string[]) => void;
	} = $props();

	const uid = $props.id();
	const tid = $derived(`${unit}-pick`);
	let dlg = $state<HTMLDialogElement>();
	let trigger: HTMLElement | null = null;
	let ticked = $state<string[]>([]);
	const ids = $derived(items.map((i) => i.id));

	$effect(() => {
		if (!dlg) return;
		if (open && !dlg.open) {
			ticked = [...ids];
			trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dlg.showModal();
		} else if (!open && dlg.open) dlg.close();
	});
	function onclose() {
		open = false;
		if (trigger?.isConnected) trigger.focus();
		trigger = null;
	}
	const picked = $derived(ids.filter((s) => ticked.includes(s)));
	const n = $derived(picked.length);
	const plural = (k: number) => `${k} ${unit}${k === 1 ? '' : 's'}`;
	function toggle(s: string, on: boolean) {
		ticked = on ? [...ticked, s] : ticked.filter((x) => x !== s);
	}
	function confirm() {
		if (!n) return;
		open = false;
		onprint(picked);
	}
	function log() {
		if (!n) return;
		open = false;
		onlog(picked);
	}
</script>

<dialog
	bind:this={dlg}
	class="ds-modal ds-modal--sheet"
	aria-labelledby="{uid}-t"
	data-testid={tid}
	{onclose}
	onclick={(e) => e.target === dlg && (open = false)}
>
	{#if open}
		<div class="pps">
			<header class="ds-modal__head pps-head">
				<h2 id="{uid}-t">{title}</h2>
				<button class="pps-x" type="button" aria-label="Cancel" onclick={() => (open = false)}
					>×</button
				>
			</header>
			<div class="ds-modal__body pps-body">
				<div class="pps-quick">
					<button
						class="btn sm"
						type="button"
						data-testid="{tid}-all"
						onclick={() => (ticked = [...ids])}>All</button
					>
					<button
						class="btn sm"
						type="button"
						data-testid="{tid}-none"
						onclick={() => (ticked = [])}>None</button
					>
					<span class="meta num">{n} of {items.length} ticked</span>
				</div>
				<ul class="pps-list">
					{#each items as it (it.id)}
						<li>
							<label class="pps-item" data-testid="{tid}-item">
								<input
									type="checkbox"
									checked={ticked.includes(it.id)}
									onchange={(e) => toggle(it.id, e.currentTarget.checked)}
								/>
								<span>{it.name}</span>
								{#if it.hint}<small class="meta">{it.hint}</small>{/if}
							</label>
						</li>
					{/each}
				</ul>
			</div>
			<footer class="ds-modal__foot pps-foot">
				<button
					class="btn primary"
					type="button"
					data-testid="{tid}-confirm"
					disabled={!n}
					onclick={confirm}
					>{n === items.length
						? `Mark all ${plural(n)} printing`
						: `Mark ${n} of ${items.length} ${unit}s printing`}</button
				>
				<button class="btn" type="button" data-testid="{tid}-log" disabled={!n} onclick={log}
					>Log {plural(n)} instead…</button
				>
				<button class="btn ghost" type="button" onclick={() => (open = false)}>Cancel</button>
			</footer>
		</div>
	{/if}
</dialog>

<style>
	.pps-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}
	.pps-head h2 {
		margin: 0;
		font-family: var(--f-display);
		font-size: var(--fs-xl);
	}
	.pps-x {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: var(--fs-xl);
		line-height: 1;
		padding: var(--sp-2) var(--sp-5);
		cursor: pointer;
	}
	.pps-quick {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		margin-bottom: var(--sp-4);
	}
	.pps-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}
	.pps-item {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 44px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		cursor: pointer;
	}
	.pps-item input {
		width: 20px;
		height: 20px;
		margin: 0;
		flex: none;
		accent-color: var(--accent);
	}
	.pps-item span {
		font-weight: 600;
		min-width: 0;
	}
	.pps-item small {
		margin-inline-start: auto;
		text-align: right;
	}
	.pps-foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
	@media (max-width: 760px) {
		.pps-foot :global(.btn) {
			flex: 1 1 100%;
		}
	}
</style>
