-- The as-built flight ortho behind the close-out exhibit (in place of Google imagery).
-- ortho_json: where the saved image sits in drawing feet {x0, y0, px, py, w, h}.
ALTER TABLE projects
  ADD COLUMN ortho_file VARCHAR(190) NULL,
  ADD COLUMN ortho_json TEXT NULL,
  ADD COLUMN ortho_flown DATE NULL
;
