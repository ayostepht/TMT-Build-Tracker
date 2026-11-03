CREATE TABLE `template_models` (
	`template_id` text PRIMARY KEY NOT NULL,
	`glb_path` text NOT NULL,
	`version` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`slugs` text DEFAULT '[]' NOT NULL,
	`source_note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `template_part_placements` (
	`template_id` text NOT NULL,
	`slug` text NOT NULL,
	`matrix` text NOT NULL,
	`instances` text DEFAULT '[]' NOT NULL,
	`placed` integer DEFAULT false NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`template_id`, `slug`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `builds` ADD `variant_choices` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `variant_groups` text DEFAULT '[]' NOT NULL;