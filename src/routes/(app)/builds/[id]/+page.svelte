<script lang="ts">
	import NowPrinting from '#lib/components/NowPrinting.svelte';
	import FilamentTiles from '#lib/components/FilamentTiles.svelte';
	import ActivityList from '#lib/components/ActivityList.svelte';
</script>

<NowPrinting />
<FilamentTiles />
<ActivityList />
<p class="foot">
	Estimates use each part's BOM weight until you enter slicer grams for a plate, then the slicer
	grams (per run where a plate prints more than once). Filament used only counts finished prints you
	log (failures included); a plate marked printed with no grams logged counts at its estimate.
</p>
