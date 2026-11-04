<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import KitCredit from '#lib/components/kit/KitCredit.svelte';
	import KitFilesImport from '#lib/components/kit/KitFilesImport.svelte';
	import KitStatus from '#lib/components/kit/KitStatus.svelte';

	/**
	 * Files tab: which kit files this build's template has (3D chair, print geometry, guide), and
	 * where admins or the template's owners add or replace them. The one drop zone besides the
	 * setup wizard's template step.
	 */
	const ctx = getBuildCtx();
	let status: KitStatus | undefined = $state();
	let canImport = $state(false);
</script>

<section class="card" id="settings" aria-labelledby="ps-h" data-testid="print-settings">
	<h2 id="ps-h">Print settings</h2>
	<p class="muted">
		{ctx.view.build.templateOwned
			? 'Files for your own chair. The plates and the 3D preview use them.'
			: "MakeGood's tuned print settings and the 3D chair for this kit."}
	</p>
	<KitStatus
		bind:this={status}
		templateId={ctx.view.build.templateId}
		compact
		onloaded={(i) => (canImport = i.canImport)}
	/>
	<KitCredit />
	{#if canImport}
		<details>
			<summary>Add or replace files</summary>
			<div class="imp">
				<KitFilesImport
					templateId={ctx.view.build.templateId}
					{canImport}
					compact
					onchange={() => {
						status?.refresh();
						void ctx.refresh();
					}}
				/>
			</div>
		</details>
	{:else}
		<p class="muted" data-testid="kit-ask-admin-print">
			{ctx.view.build.templateOwned
				? 'Ask a workspace owner or editor to add files.'
				: 'Ask your admin to add or replace the MakeGood files.'}
		</p>
	{/if}
</section>

<style>
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	.imp {
		margin-top: 10px;
	}
</style>
