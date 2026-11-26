-- Contractor history dates from the old weekly reports and daily logs
-- (CM Test Data sheet: Utility Progress + Daily Logs, Nov 2025 - Sep 2026).
-- Start = first day the work shows in the daily logs; finish = last day of
-- installation (the weekly report where it reached 100%, or where it stopped).
-- Quantities stay the design-DXF quantities so rates match what the app measures.

-- The Grove Phase 1: the emails and logs show Timber Wolf (TWX) laying the utilities, not MSB.
UPDATE history_items i JOIN history_jobs j ON j.id = i.job_id
   JOIN contractors c ON c.name = 'Timber Wolf Excavating'
   SET i.contractor_id = c.id
 WHERE j.job_no = '1714-12' AND i.item IN ('ss', 'sd', 'wl')
;
UPDATE history_items i JOIN history_jobs j ON j.id = i.job_id
  JOIN (SELECT 'clear' item, '2025-11-03' s, '2025-11-24' f   -- clearing/grubbing, brush burned through 11/24
        UNION ALL SELECT 'earth', '2025-11-03', '2026-01-07'  -- mass grading Phase I (pad finish grading Jul-Aug not counted)
        UNION ALL SELECT 'sd', '2026-03-02', '2026-07-02'     -- 95% by 6/12, last 279 LF by 7/3
        UNION ALL SELECT 'ss', '2026-03-16', '2026-08-06'     -- MH 42/43 set 8/5-8/6, 100% on the 8/21 report
        UNION ALL SELECT 'wl', '2026-04-28', '2026-07-10'     -- 98.8%; 113 LF under 131st never closed out
        UNION ALL SELECT 'sg', '2026-06-17', '2026-07-16'     -- geofabric + aggregate base
        UNION ALL SELECT 'cb', '2026-07-20', '2026-08-03'
        UNION ALL SELECT 'pv', '2026-08-05', '2026-08-13') x ON x.item = i.item
   SET i.start_date = x.s, i.finish_date = x.f
 WHERE j.job_no = '1714-12'
;
-- Pines III (one crew). Sanitary was under way before the first daily log; 1,017 LF were in
-- by 10/24/2025, so the record covers 10/27 on with the 2,583 LF laid after that.
UPDATE history_items i JOIN history_jobs j ON j.id = i.job_id
  JOIN (SELECT 'ss' item, '2025-10-27' s, '2025-12-31' f, 2583 q
        UNION ALL SELECT 'sd', '2025-12-16', '2026-01-22', NULL   -- "Storm completed" 1/22 (entry culvert waited on ONG)
        UNION ALL SELECT 'wl', '2026-03-27', '2026-04-23', NULL   -- after the RWD / ODEQ hold
        UNION ALL SELECT 'sg', '2026-05-07', '2026-07-28', NULL   -- road grading, rock crusher, stabilization
        UNION ALL SELECT 'cb', '2026-07-29', '2026-08-18', NULL   -- curb, gutter and ADA ramps
        UNION ALL SELECT 'pv', '2026-08-20', '2026-08-24', NULL) x ON x.item = i.item
   SET i.start_date = x.s, i.finish_date = x.f, i.quantity = COALESCE(x.q, i.quantity)
 WHERE j.job_no = '1915-31'
;
