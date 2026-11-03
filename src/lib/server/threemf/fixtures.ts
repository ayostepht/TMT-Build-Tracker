/**
 * Builds tiny synthetic 3MF files for tests (no MakeGood data): Bambu Studio and
 * OrcaSlicer-family projects, sliced or not, and plain 3MF. Depends on fflate only,
 * so the e2e suite can import it too.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

/** A valid 1x1 PNG. */
export const TINY_PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
	),
	(c) => c.charCodeAt(0)
);

export interface FixtureObject {
	name: string;
	extruder?: number;
	/** Instances on the plate (the same object id repeated). */
	instances?: number;
	/** Skip the `<part>` and use `<volume>` as OrcaSlicer's older exports do. */
	volume?: boolean;
}
export interface FixturePlate {
	name?: string;
	objects: FixtureObject[];
	prediction?: number;
	weight?: number;
	filaments?: Record<number, number>;
	/** Write the thumbnail entries (default true). */
	thumbnail?: boolean;
	/** Thumbnail path as the slicer recorded it (Orca writes absolute temp paths). */
	thumbnailFile?: string;
}
export interface FixtureOptions {
	app?: string;
	printerModel?: string;
	printerSettingsId?: string;
	nozzle?: string;
	layerHeight?: string;
	filamentTypes?: string[];
	filamentColours?: string[];
	filamentIds?: string[];
	plates: FixturePlate[];
	/** Write slice_info.config (a sliced file). */
	sliced?: boolean;
	/** Extra zip entries. */
	extra?: Record<string, Uint8Array>;
}

export const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function makeProjectThreeMf(o: FixtureOptions): Uint8Array {
	let nextId = 2;
	const objectXml: string[] = [];
	const plateXml: string[] = [];
	const sliceXml: string[] = [];
	const files: Zippable = {};
	o.plates.forEach((p, i) => {
		const idx = i + 1;
		const instances: string[] = [];
		for (const ob of p.objects) {
			const id = nextId++;
			const sub = ob.volume
				? `<volume firstid="0" lastid="11"><metadata key="name" value="${esc(ob.name)}"/></volume>`
				: `<part id="1" subtype="normal_part"><metadata key="name" value="${esc(ob.name)}"/></part>`;
			objectXml.push(
				`<object id="${id}"><metadata key="name" value="${esc(ob.name)}"/><metadata key="extruder" value="${ob.extruder ?? 1}"/>${sub}</object>`
			);
			for (let k = 0; k < (ob.instances ?? 1); k++)
				instances.push(
					`<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="${k}"/></model_instance>`
				);
		}
		const thumb = p.thumbnailFile ?? `Metadata/plate_${idx}.png`;
		plateXml.push(
			`<plate><metadata key="plater_id" value="${idx}"/><metadata key="plater_name" value="${esc(p.name ?? '')}"/><metadata key="thumbnail_file" value="${thumb}"/>${instances.join('')}</plate>`
		);
		if (p.thumbnail !== false) {
			files[`Metadata/plate_${idx}.png`] = TINY_PNG;
			files[`Metadata/plate_${idx}_small.png`] = TINY_PNG;
		}
		if (o.sliced) {
			const fil = Object.entries(p.filaments ?? {})
				.map(
					([id, g]) =>
						`<filament id="${id}" tray_info_idx="GFA00" type="PETG" color="#FFFFFF" used_m="1.0" used_g="${g}"/>`
				)
				.join('');
			sliceXml.push(
				`<plate><metadata key="index" value="${idx}"/><metadata key="prediction" value="${p.prediction ?? 0}"/>${p.weight !== undefined ? `<metadata key="weight" value="${p.weight}"/>` : ''}${fil}</plate>`
			);
		}
	});
	const types = o.filamentTypes ?? ['PETG'];
	files['Metadata/model_settings.config'] = strToU8(
		`<?xml version="1.0" encoding="UTF-8"?><config>${objectXml.join('')}${plateXml.join('')}</config>`
	);
	files['Metadata/project_settings.config'] = strToU8(
		JSON.stringify({
			version: '02.06.00.51',
			printer_model: o.printerModel ?? 'Bambu Lab H2D',
			printer_settings_id: o.printerSettingsId ?? 'Bambu Lab H2D 0.4 nozzle',
			nozzle_diameter: [o.nozzle ?? '0.4'],
			layer_height: o.layerHeight ?? '0.2',
			filament_type: types,
			filament_colour:
				o.filamentColours ?? types.map((_, i) => ['#00FF00', '#FFFF00'][i] ?? '#FFFFFF'),
			filament_settings_id:
				o.filamentIds ?? types.map((t) => `Bambu ${t} Basic @BBL H2D 0.4 nozzle`)
		})
	);
	if (o.sliced)
		files['Metadata/slice_info.config'] = strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header>${sliceXml.join('')}</config>`
		);
	files['3D/3dmodel.model'] = strToU8(
		`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter"><metadata name="Application">${o.app ?? 'BambuStudio-02.06.00.51'}</metadata><resources/><build/></model>`
	);
	// Stand-in for geometry the parser must never inflate.
	files['3D/Objects/object_1.model'] = new Uint8Array(200_000).fill(65);
	for (const [k, v] of Object.entries(o.extra ?? {})) files[k] = v;
	return zipSync(files);
}

export interface PlainOptions {
	objects: { id: number; name?: string }[];
	/** Build items (object ids, repeated for duplicates); default: one per object. */
	items?: number[];
	app?: string;
	/** Add a filler comment to make the model entry large. */
	padBytes?: number;
}

export function makePlainThreeMf(o: PlainOptions): Uint8Array {
	const items = o.items ?? o.objects.map((x) => x.id);
	const xml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">${o.app ? `<metadata name="Application">${o.app}</metadata>` : ''}<resources>${o.objects
		.map(
			(x) =>
				`<object id="${x.id}"${x.name ? ` name="${esc(x.name)}"` : ''} type="model"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles/></mesh></object>`
		)
		.join(
			''
		)}</resources>${o.padBytes ? `<!--${'x'.repeat(o.padBytes)}-->` : ''}<build>${items.map((i) => `<item objectid="${i}"/>`).join('')}</build></model>`;
	return zipSync({ '3D/3dmodel.model': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') });
}
