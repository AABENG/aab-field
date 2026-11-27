-- Project close-out: closing state, substantial completion, final report flag,
-- close-out files, NAS archive confirmation, and a log of close/reopen events.
ALTER TABLE projects MODIFY status ENUM('setup','active','closing','closed') NOT NULL DEFAULT 'setup'
;
ALTER TABLE projects
  ADD COLUMN substantial_completion DATE NULL,
  ADD COLUMN closeout_note TEXT NULL,
  ADD COLUMN closed_at DATETIME NULL,
  ADD COLUMN archived_at DATETIME NULL
;
ALTER TABLE weekly_reports
  ADD COLUMN is_final TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN asbuilt_file VARCHAR(255) NULL,
  ADD COLUMN summary_file VARCHAR(255) NULL
;
CREATE TABLE project_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(30) NOT NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY (project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)
;
