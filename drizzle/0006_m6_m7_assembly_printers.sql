CREATE TABLE `build_assembly` (
	`build_id` text NOT NULL,
	`item_key` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`done_by` text,
	`done_at` integer,
	PRIMARY KEY(`build_id`, `item_key`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `build_handoff` (
	`build_id` text PRIMARY KEY NOT NULL,
	`recipient_name` text,
	`organization` text,
	`contact` text,
	`handed_off_on` text,
	`location` text,
	`notes` text DEFAULT '' NOT NULL,
	`safety_checked` integer DEFAULT false NOT NULL,
	`updated_by` text,
	`updated_at` integer,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `build_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`kind` text DEFAULT 'progress' NOT NULL,
	`path` text NOT NULL,
	`thumb_path` text,
	`caption` text DEFAULT '' NOT NULL,
	`width` integer,
	`height` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `build_photos_build_idx` ON `build_photos` (`build_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`spoolman_url` text,
	`spoolman_auto_deduct` integer DEFAULT false NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `printer_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`build_id` text,
	`plate_number` integer,
	`part_slugs` text,
	`file_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'printing' NOT NULL,
	`progress` real,
	`started_at` integer,
	`finished_at` integer,
	`run_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `printer_jobs_printer_idx` ON `printer_jobs` (`printer_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`host` text NOT NULL,
	`port` integer,
	`catalog_id` text,
	`secret_enc` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`last_status` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `printers_org_idx` ON `printers` (`organization_id`);--> statement-breakpoint
CREATE TABLE `template_assembly_steps` (
	`template_id` text NOT NULL,
	`key` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`guide_page` integer,
	`parts` text DEFAULT '[]' NOT NULL,
	`hardware` text DEFAULT '[]' NOT NULL,
	`checks` text DEFAULT '[]' NOT NULL,
	`when` text,
	PRIMARY KEY(`template_id`, `key`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `template_guide_pages` ADD `image_path` text;