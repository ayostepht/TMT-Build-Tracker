<script lang="ts">
	import { buildSpoolman, linkFilamentSpool, type SpoolDto } from '#lib/client/api.ts';
	import { fmt } from '#lib/domain/index.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import Swatch from './Swatch.svelte';

	/** Build Settings, Filament section: link each filament slot to a Spoolman spool. */
	const ctx = getBuildCtx();
	let configured = $state<boolean | null>(null);
	let all = $state<SpoolDto[]>([]);
	let error = $state('');
	let picking = $state<string | null>(null);
	let q = $state('');
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			const r = await buildSpoolman(ctx.id, true);
			configured = r.configured;
			all = r.spools;
			error = r.error ?? '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Spoolman failed';
		}
		loading = false;
	}
	$effect(() => {
		void load();
	});

	const byId = $derived(new Map(all.map((s) => [s.id, s])));
	const shown = $derived.by(() => {
		const t = q.trim().toLowerCase();
		return all
			.filter(
				(s) =>
					!t || `${s.name} ${s.vendor ?? ''} ${s.material ?? ''} #${s.id}`.toLowerCase().includes(t)
			)
			.slice(0, 60);
	});
	async function choose(role: string, s: SpoolDto | null) {
		await ctx.act(() => linkFilamentSpool(ctx.id, role, s ? s.id : null, s?.name));
		picking = null;
		q = '';
	}
</script>

{#if configured === false}
	<p class="muted" data-testid="spoolman-off">
		Spoolman is not set up for this chapter. An owner can add its address on the chapter page.
	</p>
{:else if configured}
	<div class="spools" data-testid="spool-link">
		<h3>Spoolman</h3>
		{#if error}<div class="error" role="alert" style="white-space:normal">{error}</div>{/if}
		{#each ctx.view.filaments as f (f.key)}
			{@const cur = f.spoolmanSpoolId != null ? byId.get(f.spoolmanSpoolId) : undefined}
			<div class="srow" data-role={f.key}>
				<div class="who">
					<Swatch hex={f.hex} tpu={f.tpu} />
					<span>{filLabel(f, f.key)}</span>
				</div>
				<div class="cur">
					{#if f.spoolmanSpoolId == null}
						<span class="muted">No spool linked</span>
					{:else if cur}
						<span class="sp-dot" style="background:{cur.colorHex ?? 'var(--line)'}"></span>
						<span>{cur.vendor ? `${cur.vendor} ` : ''}{cur.name}</span>
						<span class="muted num"
							>{cur.remainingG != null ? `${fmt(cur.remainingG)} g left` : ''}</span
						>
					{:else}
						<span class="muted"
							>Spool #{f.spoolmanSpoolId}{loading ? '' : ' (not found in Spoolman)'}</span
						>
					{/if}
				</div>
				{#if ctx.canEdit}
					<div class="acts">
						<button
							class="btn sm"
							type="button"
							data-testid="pick-spool"
							onclick={() => ((picking = picking === f.key ? null : f.key), (q = ''))}
							>{f.spoolmanSpoolId == null ? 'Link spool…' : 'Change…'}</button
						>
						{#if f.spoolmanSpoolId != null}
							<button class="btn sm" type="button" onclick={() => choose(f.key, null)}
								>Unlink</button
							>
						{/if}
					</div>
				{/if}
				{#if picking === f.key}
					<div class="picker">
						<input
							type="search"
							placeholder="Search name, brand, material"
							bind:value={q}
							aria-label="Search spools"
							data-testid="spool-search"
						/>
						<ul>
							{#each shown as s (s.id)}
								<li>
									<button
										type="button"
										class="opt"
										data-testid="spool-option"
										onclick={() => choose(f.key, s)}
									>
										<span class="sp-dot" style="background:{s.colorHex ?? 'var(--line)'}"></span>
										<span class="nm"
											>{s.vendor ? `${s.vendor} ` : ''}{s.name}{s.material
												? ` · ${s.material}`
												: ''}</span
										>
										<span class="muted num"
											>{s.remainingG != null ? `${fmt(s.remainingG)} g` : ''}</span
										>
									</button>
								</li>
							{:else}
								<li class="muted pad">{loading ? 'Loading…' : 'No spools match.'}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.spools {
		display: grid;
		gap: var(--sp-2);
		border-top: 1px solid var(--line);
		padding-top: var(--sp-6);
	}
	h3 {
		margin: 0 0 var(--sp-2);
	}
	.srow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
		gap: var(--sp-4) var(--sp-6);
		align-items: center;
		padding: var(--sp-4) 0;
		border-top: 1px solid var(--line);
		font-size: var(--fs-md);
	}
	.who,
	.cur {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
		flex-wrap: wrap;
	}
	.acts {
		display: flex;
		gap: var(--sp-3);
	}
	.sp-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid var(--line);
		flex: none;
		display: inline-block;
	}
	.picker {
		grid-column: 1 / -1;
		display: grid;
		gap: var(--sp-3);
	}
	.picker input {
		padding: 9px var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
		font-size: var(--fs-base);
	}
	.picker ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		text-align: left;
		background: var(--card);
		color: var(--ink);
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 9px var(--sp-5);
		font-size: var(--fs-md);
	}
	.opt:hover {
		background: var(--accent-soft);
	}
	.nm {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.pad {
		padding: var(--sp-5);
	}
	@media (max-width: 760px) {
		.srow {
			grid-template-columns: 1fr;
		}
	}
</style>
