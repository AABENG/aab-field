-- Areas drawn on the daily log: ground cleared that day, and where dirt work
-- went on that day. Points are drawing coordinates (feet).
CREATE TABLE log_areas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  log_id INT UNSIGNED NOT NULL,
  kind ENUM('clear','earth') NOT NULL,
  pts_json MEDIUMTEXT NOT NULL,
  sqft DECIMAL(12,1) NOT NULL,
  FOREIGN KEY (log_id) REFERENCES daily_logs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
;
