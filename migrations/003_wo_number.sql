-- Work order number (the QuickBooks job number, e.g. 26-243.0), shown next
-- to the project/file number (e.g. 1714-12).
ALTER TABLE projects ADD COLUMN wo_no VARCHAR(20) NULL AFTER job_no
