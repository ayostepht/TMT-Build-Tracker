CREATE TABLE `build_custom_pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`build_id` text NOT NULL,
	`name` text NOT NULL,
	`file_name` text,
	`sliced` integer DEFAULT false NOT NULL,
	`replaces` text DEFAULT '[]' NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`library_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `build_custom_pieces_build_idx` ON `build_custom_pieces` (`build_id`);--> statement-breakpoint
ALTER TABLE `build_parts` ADD `skipped` integer DEFAULT false NOT NULL;