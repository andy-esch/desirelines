-- Temporary diagnostic: see README.md in this directory for when to delete it.
--
-- Read-only. Four checks over stored route geometry, with no Strava API calls:
--   Q1  how many activities look paused (elapsed >> moving); no geometry needed
--   Q2  routes with a geographic jump, per threshold, with odometer corroboration
--   Q3  vertex spacing and jump rate by route created_at cohort
--   Q4  traced-length / recorded-distance ratio by cohort (the privacy-trim
--       signal), plus how many routes are stored as more than one leg
--
-- Jumps are measured within each part of a route, so once a paused route is
-- stored as separate legs the space between them no longer counts as a jump.
-- This works for LineString and MultiLineString columns alike.
--
-- Q3 and Q4 group by the date each route row was written. A backfill run writes
-- its whole population on one date, so a cohort is a proxy for how routes were
-- sourced.
--
-- Run with the read-only role (wakes Neon compute):
--   ./scripts/database/connect.sh prod --apigateway < scripts/ops/routes/measure_route_quality.sql

\echo '=== Q1: pause candidates (no geometry required) ==='
-- An upper bound only: every auto-pause at a traffic light counts too.
SELECT
    count(*)                                                       AS activities,
    count(*) FILTER (WHERE elapsed_time - moving_time >  300)      AS stopped_gt_5min,
    count(*) FILTER (WHERE elapsed_time - moving_time > 1800)      AS stopped_gt_30min,
    round(avg(elapsed_time - moving_time))                         AS avg_stopped_s,
    max(elapsed_time - moving_time)                                AS max_stopped_s
FROM desirelines.activities
WHERE moving_time > 0;

\echo ''
\echo '=== Q2: geographic jumps in stored geometry, with odometer corroboration ==='
-- A pause adds a straight connector, so geometry traced LONGER than the recorded
-- distance corroborates a jump; simplification and privacy trimming only ever
-- shorten a route. Corroboration is only meaningful on full-length geometry: on
-- trimmed geometry it reads "not corroborated" even when the pause is real.
WITH parts AS (
    SELECT ar.activity_id, (d).path[1] AS part, (d).geom AS geom
    FROM desirelines.activity_routes ar, ST_Dump(ar.route) d
),
pts AS (
    SELECT activity_id, part, (dp).path[1] AS i, (dp).geom AS pt
    FROM parts, ST_DumpPoints(parts.geom) dp
),
segs AS (
    SELECT activity_id,
           ST_Distance(lag(pt) OVER w::geography, pt::geography) AS seg_m
    FROM pts WINDOW w AS (PARTITION BY activity_id, part ORDER BY i)
),
per_activity AS (
    SELECT s.activity_id,
           max(s.seg_m) AS max_jump_m,
           coalesce(a.distance > 0
                    AND ST_Length(ar.route::geography) > a.distance, false)
                        AS longer_than_odometer
    FROM segs s
    JOIN desirelines.activity_routes ar ON ar.activity_id = s.activity_id
    JOIN desirelines.activities      a  ON a.id           = s.activity_id
    GROUP BY s.activity_id, ar.route, a.distance
),
thresholds(jump_m) AS (VALUES (200), (300), (500), (1000))
SELECT t.jump_m                                                           AS jump_over_m,
       count(p.activity_id)                                               AS routes_with_jump,
       count(p.activity_id) FILTER (WHERE p.longer_than_odometer)         AS corroborated,
       count(p.activity_id) FILTER (WHERE NOT p.longer_than_odometer)     AS not_corroborated,
       (SELECT count(*) FROM per_activity)                                AS of_routes,
       (SELECT round(max(max_jump_m)::numeric) FROM per_activity)         AS worst_jump_m
FROM thresholds t
LEFT JOIN per_activity p ON p.max_jump_m > t.jump_m
GROUP BY t.jump_m
ORDER BY t.jump_m;

\echo ''
\echo '=== Q3: vertex spacing and jump rate by route created_at cohort ==='
-- Detailed polylines space vertices ~15-25 m apart; summary polylines are coarser.
WITH parts AS (
    SELECT ar.activity_id, ar.created_at::date AS cohort,
           (d).path[1] AS part, (d).geom AS geom
    FROM desirelines.activity_routes ar, ST_Dump(ar.route) d
),
pts AS (
    SELECT activity_id, cohort, part, (dp).path[1] AS i, (dp).geom AS pt
    FROM parts, ST_DumpPoints(parts.geom) dp
),
segs AS (
    SELECT activity_id, cohort,
           ST_Distance(lag(pt) OVER w::geography, pt::geography) AS seg_m
    FROM pts WINDOW w AS (PARTITION BY activity_id, part ORDER BY i)
),
per_activity AS (
    SELECT activity_id, cohort,
           max(seg_m) AS max_jump_m,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_m) AS median_seg_m
    FROM segs GROUP BY activity_id, cohort
)
SELECT cohort, count(*) AS routes,
       round(avg(median_seg_m)::numeric, 1)     AS avg_median_spacing_m,
       round(max(max_jump_m)::numeric)          AS worst_jump_m,
       count(*) FILTER (WHERE max_jump_m > 500) AS with_jump_gt_500m
FROM per_activity GROUP BY cohort ORDER BY cohort;

\echo ''
\echo '=== Q4: traced-length / recorded-distance by cohort (privacy-trim signal) ==='
-- A detailed, untrimmed polyline traces close to the recorded distance (above 1.0
-- when it carries a pause connector). A privacy-trimmed summary polyline is missing
-- whole end segments and is more aggressively simplified, so its ratio sits well
-- below 1. A cohort clustering low is trimmed geometry.
SELECT ar.created_at::date                                              AS cohort,
       count(*)                                                         AS routes,
       round(avg(ST_Length(ar.route::geography) / a.distance)::numeric, 3) AS avg_ratio,
       round(min(ST_Length(ar.route::geography) / a.distance)::numeric, 3) AS min_ratio,
       round(max(ST_Length(ar.route::geography) / a.distance)::numeric, 3) AS max_ratio,
       count(*) FILTER (WHERE ST_Length(ar.route::geography) / a.distance < 0.9) AS ratio_below_0_9,
       count(*) FILTER (WHERE ST_NumGeometries(ar.route) > 1)           AS split_routes
FROM desirelines.activity_routes ar
JOIN desirelines.activities a ON a.id = ar.activity_id
WHERE a.distance > 0
GROUP BY ar.created_at::date
ORDER BY cohort;
