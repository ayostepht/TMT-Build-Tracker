CREATE TABLE `build_part_profiles` (
	`build_id` text NOT NULL,
	`part_slug` text NOT NULL,
	`seconds_per_copy` real,
	`grams_by_role` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	`method` text DEFAULT 'volume-split' NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`updated_at` integer,
	PRIMARY KEY(`build_id`, `part_slug`),
	FOREIGN KEY (`build_id`) REFERENCES `builds`(`id`) ON UPDATE no action ON DELETE cascade
);
