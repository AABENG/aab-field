-- Paving is tracked as three items along the street centerline:
-- subgrade, curb and gutter (only when the project has curb), and paving.
-- The centerline geometry is stored once (project_lines.item = 'cl');
-- each highlighted stretch says which of the three it is.
ALTER TABLE projects ADD COLUMN has_curb TINYINT(1) NOT NULL DEFAULT 1
;
ALTER TABLE log_progress ADD COLUMN track ENUM('line','sg','cb','pv') NOT NULL DEFAULT 'line' AFTER line_id
