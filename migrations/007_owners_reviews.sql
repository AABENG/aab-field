-- Owners: the client contact who gets one weekly email covering all of their projects.
CREATE TABLE owners (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  company VARCHAR(160) NULL,
  emails TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
ALTER TABLE projects ADD COLUMN owner_id INT UNSIGNED NULL, ADD FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
;
-- Review workflow: Joe's notes, when the review request went out, who it was sent to.
ALTER TABLE weekly_reports
  ADD COLUMN notes TEXT NULL,
  ADD COLUMN review_sent_at TIMESTAMP NULL,
  ADD COLUMN sent_to TEXT NULL,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
;
