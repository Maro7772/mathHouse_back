-- READ-ONLY. Finds the tables whose text setting (collation) is not utf8mb4_general_ci
-- (the cause of "#1267 Illegal mix of collations"). Changes nothing.
-- utf8mb4_bin columns (JSON-style data) are normal and are ignored.
-- Run in phpMyAdmin -> SQL and send all three results.

-- 1) The database's default setting (used for every NEW table)
SELECT SCHEMA_NAME AS db, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS default_collation
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'mathshouseDB';

-- 2) How many tables use each setting
SELECT TABLE_COLLATION AS collation, COUNT(*) AS tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'mathshouseDB' AND TABLE_TYPE = 'BASE TABLE'
GROUP BY TABLE_COLLATION
ORDER BY tables DESC;

-- 3) The tables that differ
SELECT t.TABLE_NAME AS `table`,
       t.TABLE_COLLATION AS table_collation,
       (SELECT GROUP_CONCAT(DISTINCT c.COLLATION_NAME)
          FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLLATION_NAME IS NOT NULL) AS column_collations,
       t.TABLE_ROWS AS approx_rows
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = 'mathshouseDB' AND t.TABLE_TYPE = 'BASE TABLE'
  AND (t.TABLE_COLLATION <> 'utf8mb4_general_ci'
       OR EXISTS (SELECT 1 FROM information_schema.COLUMNS c
                   WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                     AND c.COLLATION_NAME IS NOT NULL
                     AND c.COLLATION_NAME NOT IN ('utf8mb4_general_ci', 'utf8mb4_bin')))
ORDER BY t.TABLE_NAME;
