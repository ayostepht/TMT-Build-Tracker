CREATE TABLE `workspace_custom_pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text,
	`sliced` integer DEFAULT false NOT NULL,
	`template_id` text,
	`replaces` text DEFAULT '[]' NOT NULL,
	`plates` text DEFAULT '[]' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspace_custom_pieces_org_idx` ON `workspace_custom_pieces` (`organization_id`);