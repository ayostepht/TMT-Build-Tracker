CREATE TABLE `spoolman_cache` (
	`organization_id` text NOT NULL,
	`spoolman_filament_id` integer NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`error` text,
	PRIMARY KEY(`organization_id`, `spoolman_filament_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `build_filaments` ADD `spoolman_filament_id` integer;--> statement-breakpoint
ALTER TABLE `build_filaments` ADD `spoolman_linked_at` integer;--> statement-breakpoint
ALTER TABLE `print_runs` ADD `created_at` integer;--> statement-breakpoint
-- Back-fill (one-off, runs once with this migration): the earliest matching `run.add` activity
-- row (payload runId / runIds), else the start of the run's date in UTC; unparseable dates stay NULL.
UPDATE `print_runs` SET `created_at` = COALESCE(
	(SELECT min(`a`.`at`) FROM `activity` `a`
		WHERE `a`.`build_id` = `print_runs`.`build_id` AND `a`.`kind` = 'run.add'
		AND CASE WHEN json_valid(`a`.`payload`) THEN (
			json_extract(`a`.`payload`, '$.runId') = `print_runs`.`id`
			OR EXISTS (SELECT 1 FROM json_each(`a`.`payload`, '$.runIds') `j` WHERE `j`.`value` = `print_runs`.`id`)
		) ELSE 0 END),
	CAST(strftime('%s', `print_runs`.`date`) AS integer) * 1000
) WHERE `created_at` IS NULL;
