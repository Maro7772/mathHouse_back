# Admin Reports API

Read-only summaries behind the admin **Reports** pages (Students, Courses, Teachers, Rates, Payments, Extra H.W).
Controller: `src/controllers/admin/reportPages.ts` · Routes: `src/routes/admin/reports.ts`.

- Base path: `/api/admin/reports`
- Auth: admin token. Permission: `reports` → `View`.
- Responses use the usual `{ success, data }` envelope. Money is in EGP (the `payment.amount` values).
- **Ratings** are the session evaluation scores in `session_student_ratings.overall_rating` (1–10).
  The admin shows them as stars out of 5 (value ÷ 2).
- `from` / `to` (where supported) are `YYYY-MM-DD`; default is the current calendar month. A bad date → `400`.

| Method | Path | Page |
| --- | --- | --- |
| GET | `/students` | Reports → Students |
| GET | `/courses` | Reports → Courses |
| GET | `/teachers?from&to` | Reports → Teachers |
| GET | `/teachers/:teacherId` | Teacher row → details window |
| GET | `/rates` | Reports → Rates |
| GET | `/payments?from&to` | Reports → Payments |
| GET | `/homework` | Reports → Extra H.W |

The older per-student routes in the same router (`/:studentId/quizzes`, `/:studentId/exams`,
`/:studentId/diagnostic-exam`) are unchanged.

## GET /students
`data.students[]`: `id, name, nickname, email, phone, country, category, grade, courses[]` (active enrolments),
`isVerified, liveBalance, examBalance, questionBalance, wallet, paid` (completed payments),
`lastPayment, present, absent, lastAttended, status`.

`status`: `Active` (4+ live sessions left) · `Low` (1–3) · `Empty` (0) · `No live sessions`
(the student never used live sessions: no balance, no attendance, no package deduction).
Country comes from the phone number (same rule as the dashboard).

## GET /courses
`data.courses[]`: `id, name, category, chapters, lessons, teachers, activeStudents, allStudents,
fromPrice` (cheapest course price in `prices`), `revenue, payments, avgRating, ratings`.

Revenue = completed payments linked to the course, either through what was enrolled with that payment
(`enrolledItems.paymentId`) or through a bought package of the course (`packages.course_id`); a payment is
counted once per course. Course rating = ratings of sessions that taught lessons of the course.

## GET /teachers?from&to
`data`: `{ from, to, teachers[] }`, each: `id, name, email, courses[], sessions` (scheduled sessions in range),
`cancelled` (in range), `allSessions`, `students` (distinct present students in range),
`attendanceRate` (% present of marked attendance in range, or `null`), `avgRating, ratings` (all time).
A session's day is `session_date` (one-off) or `start_date` (repeating).

### GET /teachers/:teacherId
`data`: `{ teacher, sessions[], reviews[] }`.
- `sessions`: last 40 sessions up to today — `id, name, day, timeFrom, timeTo, type, status, cancelReason, present, marked, avgRating`.
- `reviews`: last 30 ratings — `id, rating, comment, createdAt, sessionName, studentName`.
- Unknown teacher → `404`.

## GET /rates
`data`: `totals { ratings, avgRating, comments }`, `distribution[]` (`stars` 5…1 with `count`;
1–2 → 1★ … 9–10 → 5★), `courses[]` and `teachers[]` (`id, name, avgRating, ratings`, best first),
`comments[]` (latest 40 with text: `rating, comment, createdAt, sessionName, teacherName, studentName`).

## GET /payments?from&to
`data`:
- `totals`: `collected, collectedCount, rejected, rejectedCount, pendingInRange` (in range),
  `pendingNow, pendingNowCount` (all receipts waiting right now), `walletBalances, walletsWithBalance`.
- `byMethod[]`, `byPurpose[]` (`Wallet top-up` / `Package` / `Content`): `name, count, amount` of completed payments in range.
- `months[]`: last 12 months of completed payments (`month` = `YYYY-MM`, `amount`, `count`), ignores `from/to`.
- `transactions[]`: up to 200 payments in range, newest first —
  `id, createdAt, amount, status, reason, purpose, method, packageName, studentId, studentName`.
- `lowBalance[]`: the 0-1-2-3 countdown — students who use live sessions and have ≤ 3 left:
  `id, name, nickname, liveBalance, lastAttended, courses[]`.

Not included (no data yet; belongs to the planned Finance area): contract value, installments,
unmatched receipts, expenses, cash-flow forecast, program margins, sales per employee.

## GET /homework
`data`:
- `sets[]`: `id, title, dueDate, createdAt, targetType, targetName, assigned, submitted, late, graded, avgScore`.
- `students[]`: `id, name, nickname, assigned, submitted, missed` (not submitted and past due), `late, graded, avgScore`.

`late` = submitted after the due date. Scores are 0–100, so `avgScore` reads as a percentage.

## Notes
- `session_package_deductions.student_id` has a different collation than `student.id`; the payments query
  compares them with an explicit `COLLATE utf8mb4_general_ci`.
- Everything is computed on request. The data sizes today (hundreds of students) make this cheap; if the
  student table grows into many thousands, add paging to `/students` first.
