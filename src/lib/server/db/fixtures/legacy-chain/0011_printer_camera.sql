ALTER TABLE `printers` ADD `camera_url` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `camera_enabled` integer DEFAULT true NOT NULL;