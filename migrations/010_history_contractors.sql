-- Pines III was built by GCE; Timber Wolf did all of The Grove Phase 1, curb and paving included.
INSERT IGNORE INTO contractors (name) VALUES ('GCE')
;
UPDATE history_items i JOIN history_jobs j ON j.id = i.job_id
   JOIN contractors c ON c.name = 'GCE'
   SET i.contractor_id = c.id
 WHERE j.job_no = '1915-31'
;
UPDATE history_items i JOIN history_jobs j ON j.id = i.job_id
   JOIN contractors c ON c.name = 'Timber Wolf Excavating'
   SET i.contractor_id = c.id
 WHERE j.job_no = '1714-12'
;
