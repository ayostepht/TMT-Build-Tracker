import { isPublicMode } from '../config';

export interface ParseLimits {
	/** Max inflated size of a config entry (model_settings, slice_info, project_settings). */
	maxConfigBytes: number;
	/** Max inflated size of the XML config entries, which are parsed on the main thread. */
	maxXmlConfigBytes: number;
	/** Max inflated size of one thumbnail PNG; larger ones are dropped with a warning. */
	maxThumbBytes: number;
	/** Max inflated bytes scanned from `3D/3dmodel.model`. */
	maxModelBytes: number;
	/** Max zip entries looked at. */
	maxEntries: number;
	/** Max total bytes kept in memory across all retained entries (configs + thumbnails). */
	maxRetainedBytes: number;
	/** Max plate thumbnails kept; a thumbnail's plate number must be within 1..maxThumbs too. */
	maxThumbs: number;
	/** Max total inflated bytes read from one upload, over all entries. */
	maxInflatedBytes: number;
}
/** Self-host limits. Use `defaultLimits()` at call time: it also honours public mode. */
export const DEFAULT_LIMITS: ParseLimits = {
	// real sliced projects have configs of tens to hundreds of KB
	maxConfigBytes: 8 * 1024 * 1024,
	// parsing costs up to ~0.4 s per MB on the main thread; big multi-plate projects reach a few MB
	maxXmlConfigBytes: 8 * 1024 * 1024,
	maxThumbBytes: 8 * 1024 * 1024,
	maxModelBytes: 512 * 1024 * 1024,
	// real projects have tens to a few hundred entries; ones with many plates and objects thousands
	maxEntries: 20_000,
	maxRetainedBytes: 48 * 1024 * 1024,
	maxThumbs: 256,
	maxInflatedBytes: 1024 * 1024 * 1024
};

/** Public-mode cap for the XML configs: 8 MB costs ~1.8 s of main-thread parse per upload. */
export const PUBLIC_MAX_XML_CONFIG_BYTES = 2 * 1024 * 1024;

/**
 * The limits in force now. Resolved per call (not at import time) because the mode is read from
 * the environment, which tests and late config may set after this module loads.
 */
export function defaultLimits(): ParseLimits {
	return isPublicMode()
		? { ...DEFAULT_LIMITS, maxXmlConfigBytes: PUBLIC_MAX_XML_CONFIG_BYTES }
		: DEFAULT_LIMITS;
}
