PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_build_filaments` (
	`build_id` text NOT NULL,
	`role_key` text NOT NULL,
	`name` text NOT NULL,
	`material` text NOT NULL,
	`hex` text NOT NULL,
	`spools` real DEFAULT 0 NOT NULL,
	`spoolman_spool_id` integer,
	PRIMARY KEY(`build_id`, `role_key`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_build_filaments`("build_id", "role_key", "name", "material", "hex", "spools", "spoolman_spool_id") SELECT "build_id", "role_key", "name", "material", "hex", "spools", "spoolman_spool_id" FROM `build_filaments`;--> statement-breakpoint
DROP TABLE `build_filaments`;--> statement-breakpoint
ALTER TABLE `__new_build_filaments` RENAME TO `build_filaments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;