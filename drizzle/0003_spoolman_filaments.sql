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
ALTER TABLE `build_filaments` ADD `spoolman_linked_at` integer;