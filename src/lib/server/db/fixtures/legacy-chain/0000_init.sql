CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_build_idx` ON `activity` (`build_id`,`at`);--> statement-breakpoint
CREATE TABLE `build_filaments` (
	`build_id` text NOT NULL,
	`role_key` text NOT NULL,
	`name` text NOT NULL,
	`material` text NOT NULL,
	`hex` text NOT NULL,
	`spools` integer DEFAULT 0 NOT NULL,
	`spoolman_spool_id` integer,
	PRIMARY KEY(`build_id`, `role_key`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `build_parts` (
	`build_id` text NOT NULL,
	`part_slug` text NOT NULL,
	`status` text DEFAULT 'To print' NOT NULL,
	`started_at` integer,
	`printed_on` text,
	`comps` text DEFAULT '{}' NOT NULL,
	`assignee_user_id` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`build_id`, `part_slug`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `build_plates` (
	`build_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`est_seconds` integer,
	`runs` integer DEFAULT 1 NOT NULL,
	`per_part_runs` integer DEFAULT false NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`slicer_grams` real,
	`slicer_by_part` text DEFAULT '{}' NOT NULL,
	`thumbnail_path` text,
	PRIMARY KEY(`build_id`, `number`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`recipient` text,
	`hospital` text,
	`phase` text DEFAULT 'design' NOT NULL,
	`delivery_date` text,
	`design` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `builds_org_idx` ON `builds` (`organization_id`);--> statement-breakpoint
CREATE TABLE `color_designs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`author_user_id` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`part_roles` text DEFAULT '{}' NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `color_designs_slug_unique` ON `color_designs` (`slug`);--> statement-breakpoint
CREATE TABLE `print_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`plate_number` integer,
	`part_slug` text,
	`date` text NOT NULL,
	`result` text NOT NULL,
	`grams` real,
	`hours` real,
	`printer` text,
	`user_id` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `print_runs_build_idx` ON `print_runs` (`build_id`);--> statement-breakpoint
CREATE TABLE `template_filament_roles` (
	`template_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`material` text NOT NULL,
	`hex` text NOT NULL,
	`tpu` integer DEFAULT false NOT NULL,
	`recommended_spools` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`template_id`, `key`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `template_guide_pages` (
	`template_id` text NOT NULL,
	`page` integer NOT NULL,
	`title` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`template_id`, `page`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `template_hardware` (
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`qty` integer,
	`note` text,
	PRIMARY KEY(`template_id`, `name`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `template_parts` (
	`template_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`default_role` text NOT NULL,
	`bom_grams` real,
	`qty` integer,
	`walls` integer,
	`infill` text DEFAULT '' NOT NULL,
	`supports` text DEFAULT '' NOT NULL,
	`brim` text,
	`source_file` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	`components` text DEFAULT '[]' NOT NULL,
	`allowed_materials` text DEFAULT '[]' NOT NULL,
	`symmetry_group` text,
	`guide_refs` text DEFAULT '[]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`template_id`, `slug`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `template_plates` (
	`template_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`est_seconds` integer,
	`runs` integer DEFAULT 1 NOT NULL,
	`run_note` text,
	`per_part_runs` integer DEFAULT false NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`template_id`, `number`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_url` text,
	`global_settings` text DEFAULT '' NOT NULL,
	`sections` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_slug_unique` ON `templates` (`slug`);