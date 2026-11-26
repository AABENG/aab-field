-- Release 1 foundation schema.
-- Statements are separated by a line holding only a semicolon.

-- People who sign in. role: owner (Alan), reviewer (Joe, approves reports),
-- admin (Jamie, manages projects/users), co (construction observation),
-- contractor (self-report, Release 3).
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  role ENUM('owner','reviewer','admin','co','contractor') NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- One row per job. job_no follows the WO#/file number (e.g. 1714-12).
CREATE TABLE projects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_no VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  client VARCHAR(160) NULL,
  client_emails TEXT NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  status ENUM('setup','active','closed') NOT NULL DEFAULT 'setup',
  -- plan view box (drawing units, feet) for the exhibit
  view_box VARCHAR(80) NULL,
  -- background linework (lots, ROW, curb) as SVG path strings, JSON
  background_json MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Design linework per tracking item, from the project DXF. The DXF is the
-- 100% quantity. item: wl, ss, sd, cl (street centerline).
CREATE TABLE project_lines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  item ENUM('wl','ss','sd','cl') NOT NULL,
  source_layer VARCHAR(120) NULL,
  length_ft DECIMAL(10,2) NOT NULL,
  points_json MEDIUMTEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX (project_id, item)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Structures and fittings sitting on a line; done when highlighted over.
-- kind: mh (sanitary manhole), st (storm structure), fh (hydrant), vv (valve)
CREATE TABLE project_structures (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  kind ENUM('mh','st','fh','vv') NOT NULL,
  line_id INT UNSIGNED NOT NULL,
  station_ft DECIMAL(10,2) NOT NULL,
  x DECIMAL(12,2) NOT NULL,
  y DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (line_id) REFERENCES project_lines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Which COs work which projects.
CREATE TABLE project_members (
  project_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- One CO daily log per project per day.
CREATE TABLE daily_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  log_date DATE NOT NULL,
  author_id INT UNSIGNED NOT NULL,
  check_in VARCHAR(20) NULL,
  crew_count SMALLINT NULL,
  no_crew TINYINT(1) NOT NULL DEFAULT 0,
  weather VARCHAR(160) NULL,
  rain_in DECIMAL(5,2) NULL,
  weather_edited TINYINT(1) NOT NULL DEFAULT 0,
  equipment_json TEXT NULL,
  work_json TEXT NULL,
  notes TEXT NULL,
  client_uuid CHAR(36) NULL UNIQUE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY one_per_day (project_id, log_date),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Highlighted stretches: station range on one design line, per daily log.
CREATE TABLE log_progress (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  log_id INT UNSIGNED NOT NULL,
  line_id INT UNSIGNED NOT NULL,
  from_ft DECIMAL(10,2) NOT NULL,
  to_ft DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (log_id) REFERENCES daily_logs(id) ON DELETE CASCADE,
  FOREIGN KEY (line_id) REFERENCES project_lines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
CREATE TABLE photos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  log_id INT UNSIGNED NOT NULL,
  file_name VARCHAR(190) NOT NULL,
  taken_at DATETIME NULL,
  latitude DECIMAL(9,6) NULL,
  longitude DECIMAL(9,6) NULL,
  caption VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES daily_logs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
-- Weekly report: Draft -> review (Joe) -> approved -> sent.
CREATE TABLE weekly_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  week_ending DATE NOT NULL,
  status ENUM('draft','review','approved','sent') NOT NULL DEFAULT 'draft',
  approved_by INT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  pdf_file VARCHAR(190) NULL,
  UNIQUE KEY one_per_week (project_id, week_ending),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
