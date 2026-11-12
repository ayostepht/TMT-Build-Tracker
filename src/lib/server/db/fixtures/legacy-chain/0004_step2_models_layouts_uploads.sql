CREATE TABLE `build_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`kind` text DEFAULT '3mf' NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'parsed' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `build_uploads_build_idx` ON `build_uploads` (`build_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `template_model_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`input_path` text NOT NULL,
	`report` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `template_model_jobs_template_idx` ON `template_model_jobs` (`template_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `template_plate_layouts` (
	`template_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`printer_note` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`plates` text DEFAULT '[]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`template_id`, `key`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `build_plates` ADD `filament_grams` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `build_plates` ADD `source` text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE `builds` ADD `plate_layout` text;