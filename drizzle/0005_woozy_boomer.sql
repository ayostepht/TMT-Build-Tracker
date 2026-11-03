CREATE TABLE `template_print_geometry` (
	`template_id` text NOT NULL,
	`slug` text NOT NULL,
	`footprint` text NOT NULL,
	`hull` text NOT NULL,
	`height` real NOT NULL,
	`tris` integer DEFAULT 0 NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`mesh_path` text NOT NULL,
	`source_note` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`template_id`, `slug`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `build_plates` ADD `arrangement` text;--> statement-breakpoint
ALTER TABLE `builds` ADD `printer` text;