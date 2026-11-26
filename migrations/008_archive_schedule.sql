-- NAS archive: where this project's files go, relative to the QNAP share.
ALTER TABLE projects
  ADD COLUMN nas_folder VARCHAR(400) NULL,
  ADD COLUMN ntp_date DATE NULL,
  ADD COLUMN contract_days INT UNSIGNED NULL,
  ADD COLUMN grading_contractor_id INT UNSIGNED NULL,
  ADD COLUMN utility_contractor_id INT UNSIGNED NULL,
  ADD COLUMN paving_contractor_id INT UNSIGNED NULL
;
CREATE TABLE contractors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Dollar weight of each tracked item, for whole-site percent complete.
CREATE TABLE project_weights (
  project_id INT UNSIGNED NOT NULL,
  item VARCHAR(8) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (project_id, item),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Planned start and finish of each item (proposed, or from the contractor's schedule).
CREATE TABLE project_schedule (
  project_id INT UNSIGNED NOT NULL,
  item VARCHAR(8) NOT NULL,
  start_date DATE NOT NULL,
  finish_date DATE NOT NULL,
  source ENUM('proposed','contractor','manual') NOT NULL DEFAULT 'proposed',
  PRIMARY KEY (project_id, item),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Earthwork percent complete from LiDAR volume flights.
CREATE TABLE earthwork_progress (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  as_of DATE NOT NULL,
  pct DECIMAL(5,2) NOT NULL,
  note VARCHAR(255) NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Contractor production history: finished jobs (entered from past reports, or
-- copied from jobs logged in this app) that proposed schedules are built from.
CREATE TABLE history_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_no VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  ntp_date DATE NULL,
  project_id INT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
CREATE TABLE history_items (
  job_id INT UNSIGNED NOT NULL,
  item VARCHAR(8) NOT NULL,
  contractor_id INT UNSIGNED NULL,
  quantity DECIMAL(12,2) NULL,
  start_date DATE NULL,
  finish_date DATE NULL,
  PRIMARY KEY (job_id, item),
  FOREIGN KEY (job_id) REFERENCES history_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
INSERT INTO contractors (name) VALUES ('Timber Wolf Excavating'), ('MSB Construction'), ('Ira M. Green Construction'), ('Ellsworth Construction'), ('BR Heavy Construction')
;
-- Starting history: The Grove Phase 1 (Timber Wolf grading, MSB utilities, Ira M. Green paving)
-- and Pines III. Quantities from the design DXFs; dates to be filled in from the old weekly reports.
INSERT INTO history_jobs (job_no, name) VALUES ('1714-12', 'The Grove Phase 1'), ('1915-31', 'Pines III')
;
INSERT INTO history_items (job_id, item, contractor_id, quantity)
  SELECT j.id, x.item, c.id, x.qty FROM history_jobs j
  JOIN (SELECT 'clear' item, NULL qty, 'Timber Wolf Excavating' c UNION ALL SELECT 'earth', NULL, 'Timber Wolf Excavating'
        UNION ALL SELECT 'ss', 11178, 'MSB Construction' UNION ALL SELECT 'sd', 6593, 'MSB Construction' UNION ALL SELECT 'wl', 8640, 'MSB Construction'
        UNION ALL SELECT 'sg', 5363, 'Ira M. Green Construction' UNION ALL SELECT 'cb', 5363, 'Ira M. Green Construction' UNION ALL SELECT 'pv', 5363, 'Ira M. Green Construction') x
  LEFT JOIN contractors c ON c.name = x.c
  WHERE j.job_no = '1714-12'
;
INSERT INTO history_items (job_id, item, quantity)
  SELECT j.id, x.item, x.qty FROM history_jobs j
  JOIN (SELECT 'clear' item, NULL qty UNION ALL SELECT 'earth', NULL UNION ALL SELECT 'ss', 3686 UNION ALL SELECT 'sd', 1028
        UNION ALL SELECT 'wl', 4096 UNION ALL SELECT 'sg', 3400 UNION ALL SELECT 'cb', 3400 UNION ALL SELECT 'pv', 3400) x
  WHERE j.job_no = '1915-31'
;
