-- Coordinate system of the project drawing, used to place the design on the
-- aerial and to turn the drawing's center into the site latitude/longitude.
ALTER TABLE projects ADD COLUMN crs VARCHAR(20) NOT NULL DEFAULT 'EPSG:2267' AFTER view_box
