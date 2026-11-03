/**
 * Where OrcaSlicer / Bambu Studio put plate N inside their single shared build volume.
 *
 * A project 3MF has one coordinate space for all plates. A slicer decides which plate an
 * instance belongs to from its position, so a plate's items must be offset by the plate's
 * origin. The rules below are copied from OrcaSlicer (SoftFever/OrcaSlicer, main):
 *
 * - `src/slic3r/GUI/PartPlate.hpp:62` `compute_colum_count(count)`: `value = sqrt(count)`,
 *   `round_value = round(value)`; columns = `round_value + 1` when `value > round_value`
 *   else `round_value`. (1 plate: 1, 2-3: 2, 4: 2, 5-9: 3, ...)
 * - `PartPlate.cpp:132` `LOGICAL_PART_PLATE_GAP = 1. / 5.`
 * - `PartPlate.cpp:5982` `PartPlateList::compute_shape_position(index, cols)`:
 *   `row = index / cols; col = index % cols; x = col * plate_stride_x(); y = -row * plate_stride_y()`
 * - `PartPlate.cpp:6976-6989` `plate_stride_x() = plate_width * (1 + GAP)`,
 *   `plate_stride_y() = plate_depth * (1 + GAP)` (width / depth = bed bounding box).
 * - `PartPlate.cpp:7013` `update_plate_cols()`: `m_plate_cols = compute_colum_count(plate count)`.
 *
 * So plate 1 sits at the origin (its bed is x 0..W, y 0..D, front-left corner at 0,0) and
 * the next plates go to the right, then wrap to the row below (negative y). Bambu Studio
 * uses the same code (OrcaSlicer is a fork). Plate membership of loaded items is rebuilt from
 * their positions (`PartPlate.cpp:8472` load_from_3mf_structure notes the instance lists
 * are only a consistency check), so the offsets are required, not optional; the
 * `<plate><model_instance>` lists in model_settings.config are written too.
 */
export const LOGICAL_PART_PLATE_GAP = 1 / 5;

/** Number of plate columns for `count` plates (`compute_colum_count`). */
export function plateColumns(count: number): number {
	if (count <= 0) return 1;
	const value = Math.fround(Math.sqrt(count));
	const rounded = Math.round(value);
	return value > rounded ? rounded + 1 : rounded;
}

/** Origin (front-left corner of the bed) of 0-based plate `index` out of `count` plates. */
export function plateOrigin(
	index: number,
	count: number,
	bedX: number,
	bedY: number
): { x: number; y: number } {
	const cols = plateColumns(count);
	const row = Math.floor(index / cols);
	const col = index % cols;
	return {
		x: col * (bedX * (1 + LOGICAL_PART_PLATE_GAP)),
		y: row === 0 ? 0 : -row * (bedY * (1 + LOGICAL_PART_PLATE_GAP))
	};
}
