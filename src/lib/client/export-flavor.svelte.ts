import type { ExportFlavor } from '#lib/client/api.ts';

const KEY = 'tmt-export-flavor';
const FLAVORS: ExportFlavor[] = ['orca', 'bambu', 'plain'];

/** The slicer format last chosen on this device (shared by the Export card and the per-plate buttons). */
class ExportPref {
	#flavor = $state<ExportFlavor>('orca');
	#loaded = false;
	get flavor(): ExportFlavor {
		return this.#flavor;
	}
	set flavor(v: ExportFlavor) {
		this.#flavor = v;
		try {
			localStorage.setItem(KEY, v);
		} catch {
			/* storage unavailable: still works for this visit */
		}
	}
	/** Read the saved choice once (browser only; storage may be blocked). */
	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		try {
			const v = localStorage.getItem(KEY) as ExportFlavor | null;
			if (v && FLAVORS.includes(v)) this.#flavor = v;
		} catch {
			/* keep the default */
		}
	}
}

export const exportPref = new ExportPref();

export const FLAVOR_OPTIONS: { key: ExportFlavor; label: string; short: string }[] = [
	{ key: 'orca', label: 'Elegoo Slicer / OrcaSlicer', short: 'Orca' },
	{ key: 'bambu', label: 'Bambu Studio', short: 'Bambu' },
	{ key: 'plain', label: 'Other slicer (plain 3MF per plate)', short: 'Plain 3MF' }
];
