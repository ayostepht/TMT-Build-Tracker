-- FROZEN FIXTURE: invented data as a 0.9.0 install could hold it. Never regenerate or edit this file
-- after 0.9.0 is tagged; for a later release add a new fixtures/v<next>/ folder instead.
-- Only invented values: @example.com addresses, "Demo ..." names, dummy secrets. The encrypted
-- printer secret below is a placeholder string; the upgrade test never decrypts it.
-- Timestamps are epoch milliseconds. Loaded with foreign keys ON, parents first.

-- Auth (as Better Auth stores it)
INSERT INTO `user` (id, name, email, email_verified, image, created_at, updated_at) VALUES
 ('u-owner', 'Demo Owner', 'owner@example.com', 1, NULL, 1790000000000, 1790000000000),
 ('u-editor', 'Demo Editor', 'editor@example.com', 0, NULL, 1790000100000, 1790000100000),
 ('u-viewer', 'Demo Viewer', 'viewer@example.com', 0, NULL, 1790000200000, 1790000200000);
INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at) VALUES
 ('acc-owner', 'u-owner', 'credential', 'u-owner', NULL, NULL, NULL, NULL, NULL, NULL, 'dummy-password-hash-owner', 1790000000000, 1790000000000),
 ('acc-editor', 'u-editor', 'credential', 'u-editor', NULL, NULL, NULL, NULL, NULL, NULL, 'dummy-password-hash-editor', 1790000100000, 1790000100000),
 ('acc-viewer', 'demo-subject', 'oidc', 'u-viewer', 'demo-access-token', 'demo-refresh-token', 'demo-id-token', 1790999999000, 1791999999000, 'openid email', NULL, 1790000200000, 1790000200000);
INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id, active_organization_id) VALUES
 ('ses-owner', 1799999999000, 'demo-session-token-owner', 1790001000000, 1790001000000, '', 'Demo Browser', 'u-owner', 'org-demo'),
 ('ses-editor', 1799999999000, 'demo-session-token-editor', 1790001100000, 1790001100000, '203.0.113.7', 'Demo Browser', 'u-editor', 'org-demo');
INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES
 ('ver-1', 'demo-identifier', 'demo-value', 1799999999000, 1790001200000, 1790001200000);
INSERT INTO site_admin (user_id, granted_by, granted_at) VALUES ('u-owner', NULL, 1790000000000);

-- Teams
INSERT INTO organization (id, name, slug, logo, created_at, metadata) VALUES
 ('org-demo', 'Demo Chapter', 'demo-chapter', NULL, 1790000000000, NULL),
 ('org-solo', 'Demo Personal', 'demo-personal', NULL, 1790000300000, '{"personal":true}');
INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
 ('mem-1', 'org-demo', 'u-owner', 'owner', 1790000000000),
 ('mem-2', 'org-demo', 'u-editor', 'admin', 1790000100000),
 ('mem-3', 'org-demo', 'u-viewer', 'member', 1790000200000),
 ('mem-4', 'org-solo', 'u-viewer', 'owner', 1790000300000);
INSERT INTO invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) VALUES
 ('inv-1', 'org-demo', 'invitee@example.com', 'member', 'pending', 1799999999000, 1790002000000, 'u-owner');
INSERT INTO organization_settings (organization_id, spoolman_url, spoolman_auto_deduct, settings, updated_at) VALUES
 ('org-demo', 'http://spoolman.example.com:7912', 1, '{"demo":true}', 1790002100000);

-- Templates: a global one (as seeded) and a team's copy of it
INSERT INTO templates (id, slug, name, version, description, source_url, global_settings, sections, variant_groups, owner_org_id, base_template_id, created_at) VALUES
 ('tpl-demo', 'demo-chair', 'Demo Chair', '1.0', 'An invented kit for the upgrade test.', NULL, 'Demo settings', '["Seat","Frame"]', '[{"key":"wheels","label":"Wheels","options":[{"key":"small","label":"Small"},{"key":"large","label":"Large"}],"default":"small"}]', NULL, NULL, 1790003000000),
 ('tpl-copy', 'demo-chair-team-copy', 'Demo Chair (team copy)', '1.0', 'A team copy.', NULL, 'Demo settings', '["Seat","Frame"]', '[]', 'org-demo', 'tpl-demo', 1790003100000);
INSERT INTO template_filament_roles (template_id, key, name, material, hex, tpu, recommended_spools) VALUES
 ('tpl-demo', 'primary', 'Primary', 'PETG', '#336699', 0, 2),
 ('tpl-demo', 'tire', 'Tire', 'TPU', '#222222', 1, 1),
 ('tpl-copy', 'primary', 'Primary', 'PETG', '#336699', 0, 2);
INSERT INTO template_parts (template_id, slug, name, section, default_role, bom_grams, qty, walls, infill, supports, brim, source_file, notes, components, allowed_materials, symmetry_group, guide_refs, sort) VALUES
 ('tpl-demo', 'demo-seat', 'Demo Seat', 'Seat', 'primary', 120.5, 1, 3, '15%', 'none', NULL, 'demo-seat.step', '["Demo note"]', '[]', '["PETG","PLA"]', NULL, '[1]', 0),
 ('tpl-demo', 'demo-back', 'Demo Back', 'Seat', 'primary', 80, 1, 3, '15%', 'none', '5mm', 'demo-back.step', '[]', '[]', '["PETG"]', NULL, '[]', 1),
 ('tpl-demo', 'demo-leg', 'Demo Leg', 'Frame', 'primary', 40, 4, 4, '20%', 'tree', NULL, 'demo-leg.step', '[]', '["a","b"]', '["PETG"]', 'legs', '[2,3]', 2),
 ('tpl-demo', 'demo-tire', 'Demo Tire', 'Frame', 'tire', 30, 2, 2, '10%', 'none', NULL, 'demo-tire.step', '[]', '[]', '["TPU"]', NULL, '[]', 3),
 ('tpl-copy', 'demo-seat', 'Demo Seat', 'Seat', 'primary', 120.5, 1, 3, '15%', 'none', NULL, 'demo-seat.step', '[]', '[]', '["PETG"]', NULL, '[]', 0);
INSERT INTO template_plates (template_id, number, name, est_seconds, runs, run_note, per_part_runs, parts) VALUES
 ('tpl-demo', 1, 'Plate 1: seat', 36000, 1, NULL, 0, '["demo-seat","demo-back"]'),
 ('tpl-demo', 2, 'Plate 2: legs', 18000, 2, 'Run twice', 1, '["demo-leg","demo-tire"]');
INSERT INTO template_plate_layouts (template_id, key, name, printer_note, is_default, plates, sort) VALUES
 ('tpl-demo', 'default', 'Demo layout', 'Any 256 mm bed', 1, '[{"number":1,"parts":["demo-seat"]}]', 0);
INSERT INTO template_assembly_steps (template_id, key, sort, title, description, guide_page, parts, hardware, checks, "when") VALUES
 ('tpl-demo', 'step-1', 0, 'Attach legs', 'Demo description', 4, '["demo-leg"]', '["Demo bolt"]', '["Legs are level"]', NULL),
 ('tpl-demo', 'step-2', 1, 'Large wheels', '', NULL, '[]', '[]', '[]', '{"group":"wheels","option":"large"}');
INSERT INTO template_guide_pages (template_id, page, title, sort, image_path) VALUES ('tpl-demo', 1, 'Demo page', 0, NULL);
INSERT INTO template_hardware (template_id, name, qty, note) VALUES ('tpl-demo', 'Demo bolt', 8, 'M5'), ('tpl-demo', 'Demo washer', NULL, NULL);
INSERT INTO template_part_placements (template_id, slug, matrix, instances, placed, updated_by, updated_at) VALUES
 ('tpl-demo', 'demo-seat', '[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]', '[]', 1, 'u-owner', 1790003200000),
 ('tpl-demo', 'demo-leg', '[1,0,0,5,0,1,0,0,0,0,1,0,0,0,0,1]', '[[1,0,0,10,0,1,0,0,0,0,1,0,0,0,0,1]]', 0, NULL, 1790003200000);
INSERT INTO template_print_geometry (template_id, slug, footprint, hull, height, tris, settings, mesh_path, source_note, updated_at) VALUES
 ('tpl-demo', 'demo-seat', '{"w":100,"d":80}', '[[0,0],[100,0],[100,80],[0,80]]', 12.5, 1234, '{}', 'demo/demo-seat.bin', 'demo', 1790003300000);
INSERT INTO template_models (template_id, glb_path, version, size, slugs, source_note, created_by, created_at) VALUES
 ('tpl-demo', 'demo/model.glb', 'demo-1', 2048, '["demo-seat"]', 'demo', 'u-owner', 1790003400000);
INSERT INTO template_model_jobs (id, template_id, status, progress, message, input_path, report, created_by, created_at, finished_at) VALUES
 ('job-model-1', 'tpl-demo', 'done', 100, 'Finished', 'demo/input.zip', '[{"ok":true}]', 'u-owner', 1790003500000, 1790003600000);

-- Color designs and custom filaments
INSERT INTO color_designs (id, template_id, slug, name, author_user_id, roles, part_roles, is_public, created_at) VALUES
 ('des-1', 'tpl-demo', 'demo-design', 'Demo Design', 'u-owner', '[{"key":"primary","name":"Demo Blue","hex":"#336699"}]', '{"demo-seat":"primary"}', 1, 1790004000000);
INSERT INTO custom_filaments (id, organization_id, brand, material, color_name, hex, finish, hardness, url, notes, created_by, created_at, updated_at) VALUES
 ('cf-1', 'org-demo', 'Demo Brand', 'PETG', 'Demo Teal', '#008080', 'matte', NULL, 'https://example.com/demo-teal', 'Demo note', 'u-owner', 1790004100000, NULL);

-- Printers and jobs (one of each kind, plus a printer reached by link)
INSERT INTO printers (id, organization_id, name, kind, host, port, catalog_id, secret_enc, enabled, camera_url, camera_enabled, last_seen_at, last_status, created_by, created_at) VALUES
 ('prn-manual', 'org-demo', 'Demo Manual', 'manual', 'manual', NULL, NULL, NULL, 1, NULL, 1, NULL, NULL, 'u-owner', 1790005000000),
 ('prn-link', 'org-demo', 'Demo Link', 'elegoo-sdcp', 'octoeverywhere', NULL, NULL, 'v1:DUMMYSECRET+placeholder/not-decryptable=', 1, NULL, 1, 1790005500000, '{"state":"idle"}', 'u-owner', 1790005100000),
 ('prn-elegoo', 'org-demo', 'Demo Elegoo', 'elegoo-sdcp', 'printer-a.example.com', 3030, 'demo-catalog', 'v1:DUMMYSECRET+placeholder/not-decryptable=', 1, 'http://printer-a.example.com:3031/video', 1, NULL, NULL, 'u-editor', 1790005200000),
 ('prn-moon', 'org-demo', 'Demo Moonraker', 'moonraker', 'printer-b.example.com', 7125, NULL, 'v1:DUMMYSECRET+placeholder/not-decryptable=', 0, NULL, 0, NULL, NULL, 'u-editor', 1790005300000),
 ('prn-octo', 'org-demo', 'Demo OctoPrint', 'octoprint', 'printer-c.example.com', 80, NULL, 'v1:DUMMYSECRET+placeholder/not-decryptable=', 1, NULL, 1, NULL, NULL, NULL, 1790005400000),
 ('prn-bambu', 'org-solo', 'Demo Bambu', 'bambu-lan', 'printer-d.example.com', NULL, NULL, 'v1:DUMMYSECRET+placeholder/not-decryptable=', 1, NULL, 1, NULL, NULL, 'u-viewer', 1790005450000);

-- Builds
INSERT INTO builds (id, organization_id, template_id, name, recipient, hospital, phase, delivery_date, design, variant_choices, plate_layout, printer, setup_step, kind, created_by, created_at) VALUES
 ('bld-1', 'org-demo', 'tpl-demo', 'Demo Build', 'Demo Recipient', 'Demo Hospital', 'print', '2027-01-15', '{"slug":"demo-design","roles":{"primary":"#336699"}}', '{"wheels":"large"}', 'default', '{"catalogId":null,"name":"Demo Printer","bedX":256,"bedY":256,"bedZ":256,"mmSlots":4,"nozzle":0.4,"margin":5,"spacing":8}', NULL, 'build', 'u-owner', 1790006000000),
 ('bld-2', 'org-demo', 'tpl-copy', 'Demo Draft', NULL, NULL, 'design', NULL, NULL, NULL, NULL, NULL, 2, 'draft', 'u-editor', 1790006100000);
INSERT INTO build_parts (build_id, part_slug, status, started_at, printed_on, run_est_seconds, comps, assignee_user_id, updated_at) VALUES
 ('bld-1', 'demo-seat', 'Printed', NULL, '2026-12-01', NULL, '{}', 'u-owner', 1790006200000),
 ('bld-1', 'demo-back', 'Printing', 1790006300000, NULL, 36000, '{}', 'u-editor', 1790006300000),
 ('bld-1', 'demo-leg', 'Reprint', NULL, NULL, NULL, '{"a":true,"b":false}', NULL, 1790006400000),
 ('bld-1', 'demo-tire', 'To print', NULL, NULL, NULL, '{}', NULL, 1790006000000),
 ('bld-2', 'demo-seat', 'To print', NULL, NULL, NULL, '{}', NULL, 1790006100000);
INSERT INTO build_filaments (build_id, role_key, name, material, hex, spools, spoolman_spool_id) VALUES
 ('bld-1', 'primary', 'Demo Blue', 'PETG', '#336699', 1.5, 42),
 ('bld-1', 'tire', 'Demo Black', 'TPU', '#222222', 0.25, NULL);
INSERT INTO build_plates (build_id, number, name, est_seconds, runs, per_part_runs, parts, slicer_grams, manual_est_seconds, manual_est_source, slicer_by_part, thumbnail_path, filament_grams, arrangement, source) VALUES
 ('bld-1', 1, 'Plate 1: seat', 36000, 1, 0, '["demo-seat","demo-back"]', 205.5, NULL, NULL, '{"demo-seat":120.5}', NULL, '{"primary":205.5}', NULL, 'template'),
 ('bld-1', 2, 'Plate 2: legs', 18000, 2, 1, '["demo-leg","demo-tire"]', NULL, 17000, 'manual', '{}', 'demo/thumb.png', '{}', '{"parts":[]}', 'upload');
INSERT INTO build_part_profiles (build_id, part_slug, seconds_per_copy, grams_by_role, source, method, context, updated_at) VALUES
 ('bld-1', 'demo-seat', 3600.5, '{"primary":120.5}', 'demo.3mf', 'volume-split', '{"nozzle":0.4}', 1790006500000);
INSERT INTO build_uploads (id, build_id, kind, file_name, size, summary, status, created_by, created_at) VALUES
 ('up-1', 'bld-1', '3mf', 'demo.3mf', 4096, '{"plates":2}', 'parsed', 'u-owner', 1790006600000);
INSERT INTO build_photos (id, build_id, kind, path, thumb_path, caption, width, height, created_by, created_at) VALUES
 ('ph-1', 'bld-1', 'progress', 'demo/ph-1.jpg', 'demo/ph-1-thumb.jpg', 'Demo caption', 800, 600, 'u-owner', 1790006700000),
 ('ph-2', 'bld-1', 'finished', 'demo/ph-2.jpg', NULL, '', NULL, NULL, NULL, 1790006800000);
INSERT INTO build_assembly (build_id, item_key, done, note, done_by, done_at) VALUES
 ('bld-1', 'step-1:0', 1, 'Demo note', 'u-editor', 1790006900000),
 ('bld-1', 'step-1:1', 0, '', NULL, NULL);
INSERT INTO build_handoff (build_id, recipient_name, organization, contact, handed_off_on, location, notes, safety_checked, updated_by, updated_at) VALUES
 ('bld-1', 'Demo Recipient', 'Demo Hospital', 'recipient@example.com', '2027-01-15', 'Demo City', 'Demo notes', 1, 'u-owner', 1790007000000);
INSERT INTO print_runs (id, build_id, plate_number, part_slug, part_slugs, date, result, grams, hours, est_seconds, printer, user_id, note) VALUES
 ('run-1', 'bld-1', 1, NULL, '["demo-seat","demo-back"]', '2026-12-01', 'Success', 205.5, 10.1, 36000, 'Demo Printer', 'u-owner', ''),
 ('run-2', 'bld-1', 2, 'demo-leg', NULL, '2026-12-02', 'Failed', 12.25, 1.5, NULL, NULL, 'u-editor', 'Warped, demo note'),
 ('run-3', 'bld-1', NULL, 'demo-tire', NULL, '2026-12-03', 'Partial', NULL, NULL, NULL, 'Demo Printer', NULL, '');
INSERT INTO printer_jobs (id, printer_id, build_id, plate_number, part_slugs, file_name, status, progress, started_at, finished_at, run_id, created_at) VALUES
 ('pj-1', 'prn-elegoo', 'bld-1', 1, '["demo-seat","demo-back"]', 'demo-plate-1.gcode.3mf', 'done', 1, 1790007100000, 1790007200000, 'run-1', 1790007100000),
 ('pj-2', 'prn-link', NULL, NULL, NULL, 'unknown-file.gcode', 'failed', 0.25, 1790007300000, 1790007400000, NULL, 1790007300000),
 ('pj-3', 'prn-elegoo', 'bld-1', 2, NULL, 'demo-plate-2.gcode.3mf', 'printing', 0.5, 1790007500000, NULL, NULL, 1790007500000);

-- Activity (several kinds, including the historical build.import)
INSERT INTO activity (id, build_id, user_id, kind, payload, at) VALUES
 ('act-1', 'bld-1', 'u-owner', 'build.create', '{}', 1790006000000),
 ('act-2', 'bld-1', 'u-editor', 'run.add', '{"result":"Failed","plate":2}', 1790007600000),
 ('act-3', 'bld-1', NULL, 'build.import', '{"parts":4,"runs":3,"replaced":true}', 1790007700000),
 ('act-4', 'bld-1', 'u-owner', 'build.update', '{"changes":{"name":"Demo Build"}}', 1790007800000),
 ('act-5', 'bld-2', 'u-editor', 'build.create', '{}', 1790006100000);
