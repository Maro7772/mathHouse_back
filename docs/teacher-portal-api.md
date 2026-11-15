# Teacher Portal API

Endpoints used by the teacher dashboard (`TeacherDashboard`) and the admin side that answers it.
All responses use `{ success, data }`. Teacher endpoints need a teacher token (`POST /api/teacher/auth/login`).

## Database (migration `drizzle/0019_teacher_portal.sql`)

- `teacher_requests` — cover / cancellation requests (`pending` → `accepted` | `rejected`).
- `teacher_availability` — weekly availability rows (`day_of_week` 0 = Sunday … 6 = Saturday).
- `sessions.status` (`scheduled` | `cancelled`), `cancel_reason`, `cancelled_by` (`admin` | `teacher`), `cancelled_at`.

Also run `drizzle/manual/2026-11-12_fix_enrolled_items_expires_at.sql` on every database: without it,
marking attendance fails for sessions with no `contentAccessDays`.

## Teacher — `/api/teacher`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/sessions` | | Every session, now with `status`, `cancelReason`, `cancelledBy`, `students[]` (name + attendance), `studentsCount`, lesson `category` |
| PATCH | `/sessions/:id/meeting-link` | `{ session_link }` | `""` removes the link |
| PUT | `/sessions/:id/attendance` | `{ attendance: [{ studentId, status: "present" \| "absent" }] }` | "present" deducts 1 live session (once) and unlocks lessons — shared with admin manual attendance (`utils/sessionAttendance.ts`) |
| GET | `/requests` | | The teacher's requests, newest first |
| POST | `/requests` | cover: `{ type: "cover", requestDate, timeFrom, timeTo, reason }` · cancellation: `{ type: "cancellation", sessionId, reason }` | One pending cancellation per session |
| DELETE | `/requests/:id` | | Withdraw a pending request |
| GET | `/availability` | | `{ sharedAt, slots: [{ dayOfWeek, timeFrom, timeTo }] }` |
| PUT | `/availability` | `{ slots: [...] }` | Replaces the whole week; overlapping ranges on one day are rejected |
| GET | `/notifications` | | Last 50, with `unread` count |
| PATCH | `/notifications/read` | `{ ids? }` | No ids → mark all read |

## Admin — `/api/admin`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/teacher-requests?status=&teacherId=` | teachers · View | |
| PATCH | `/teacher-requests/:id/respond` | teachers · Edit | `{ status: "accepted" \| "rejected", adminReply?, coverTeacherId? }`. Accepted cancellation cancels the session. Accepted cover with `coverTeacherId` moves that teacher's single-date sessions overlapping the slot to the cover teacher. The teacher gets a notification. |
| GET | `/teacher-requests/availability/:teacherId` | teachers · View | |
| PATCH | `/session/:id/cancel` | sessions · Edit | `{ reason }` |
| PATCH | `/session/:id/restore` | sessions · Edit | |

## Local demo data

`npm run seed:teacher-demo` creates a demo teacher, a demo super admin, four demo students and sessions
around today (logins in `src/seeds/teacherPortalDemo.ts`). Local only — never run it against production.
