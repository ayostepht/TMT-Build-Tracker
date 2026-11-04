ALTER TABLE `builds` ADD `setup_step` integer;--> statement-breakpoint
ALTER TABLE `templates` ADD `owner_org_id` text REFERENCES organization(id);--> statement-breakpoint
ALTER TABLE `templates` ADD `base_template_id` text;--> statement-breakpoint
CREATE INDEX `templates_owner_org_idx` ON `templates` (`owner_org_id`);