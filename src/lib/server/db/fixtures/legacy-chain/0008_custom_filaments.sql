CREATE TABLE `custom_filaments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`brand` text NOT NULL,
	`material` text NOT NULL,
	`color_name` text NOT NULL,
	`hex` text NOT NULL,
	`finish` text,
	`hardness` text,
	`url` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `custom_filaments_org_idx` ON `custom_filaments` (`organization_id`);