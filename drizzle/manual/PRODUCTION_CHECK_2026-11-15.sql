-- READ-ONLY check: what the live database already has. Changes nothing.
-- Run it in phpMyAdmin → SQL (with the live database selected) and send the result.
SELECT 'version' AS kind, VERSION() AS item, '' AS present
UNION ALL
SELECT 'table', t.n, IF(COUNT(i.TABLE_NAME) > 0, 'YES', 'no')
FROM (
  SELECT 'teacher_availability' AS n UNION ALL SELECT 'teacher_requests' UNION ALL SELECT 'student_cancel_requests'
  UNION ALL SELECT 'finance_accounts' UNION ALL SELECT 'finance_adjustments' UNION ALL SELECT 'finance_close_items'
  UNION ALL SELECT 'finance_close_versions' UNION ALL SELECT 'finance_expenses' UNION ALL SELECT 'finance_reconciliations'
  UNION ALL SELECT 'finance_refunds' UNION ALL SELECT 'finance_teacher_contracts' UNION ALL SELECT 'finance_teacher_settlements'
  UNION ALL SELECT 'finance_unmatched' UNION ALL SELECT 'notes' UNION ALL SELECT 'session_package_deductions'
) t
LEFT JOIN information_schema.TABLES i ON i.TABLE_SCHEMA = DATABASE() AND i.TABLE_NAME = t.n
GROUP BY t.n
UNION ALL
SELECT 'column', CONCAT(c.tb, '.', c.col), IF(COUNT(i.COLUMN_NAME) > 0, 'YES', 'no')
FROM (
  SELECT 'sessions' AS tb, 'status' AS col UNION ALL SELECT 'sessions', 'cancel_reason'
  UNION ALL SELECT 'sessions', 'cancelled_by' UNION ALL SELECT 'sessions', 'cancelled_at'
  UNION ALL SELECT 'sessions', 'confirmed_at' UNION ALL SELECT 'sessions', 'confirmed_by'
  UNION ALL SELECT 'popups', 'is_active' UNION ALL SELECT 'student_plan_sessions', 'student_response'
) c
LEFT JOIN information_schema.COLUMNS i ON i.TABLE_SCHEMA = DATABASE() AND i.TABLE_NAME = c.tb AND i.COLUMN_NAME = c.col
GROUP BY c.tb, c.col
UNION ALL
SELECT 'enrolledItems.expiresAt', COLUMN_TYPE, CONCAT('null=', IS_NULLABLE, ' default=', IFNULL(COLUMN_DEFAULT, 'NULL'), ' ', EXTRA)
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enrolledItems' AND COLUMN_NAME = 'expiresAt'
UNION ALL
SELECT 'fk enrolledItems.priceId', CONSTRAINT_NAME, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'enrolledItems' AND REFERENCED_TABLE_NAME = 'prices'
UNION ALL
SELECT 'fk teacher_availability', CONSTRAINT_NAME, DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_availability'
UNION ALL
SELECT 'category National Learning', IFNULL(parent_category_id, 'NULL (ok)'), name
FROM category WHERE id = '163633e4-9bd4-4c8a-a689-abaf5ef27104';
