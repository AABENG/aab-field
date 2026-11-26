-- Limits of clearing from the design drawing: closed areas (drawing feet).
-- Clearing drawn in the field is only counted inside these.
ALTER TABLE projects ADD COLUMN clearing_json MEDIUMTEXT NULL
;
