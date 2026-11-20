ALTER TABLE `build_parts` ADD `printing_comps` text;--> statement-breakpoint
ALTER TABLE `print_runs` ADD `comps` text;--> statement-breakpoint
ALTER TABLE `printer_jobs` ADD `comps` text;