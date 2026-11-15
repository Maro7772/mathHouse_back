# Student Portal API (new endpoints)

Added for the new student dashboard design (`student-math`). All responses use `{ success, data }` and
need a student token (`POST /api/user/auth/login`). Migration: `drizzle/0020_student_portal.sql`
(table `student_cancel_requests`).

## Student — `/api/user`

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/sessions/upcoming`, `/sessions/history` | | Now also return `teacherName`, `status` (`scheduled` \| `cancelled`) and `cancelReason` |
| POST | `/sessions/:sessionId/join` | | Refuses cancelled sessions |
| GET | `/sessions/cancel-requests` | | The student's requests, newest first |
| POST | `/sessions/:sessionId/cancel-request` | `{ reason }` (≥ 5 chars) | Only until **24 hours before** the session starts (Cairo time); one open request per session |
| DELETE | `/sessions/cancel-requests/:id` | | Withdraw a pending request |
| GET | `/notifications` | | Last 50 notifications sent to the student, with `unread` count |
| PATCH | `/notifications/read` | `{ ids? }` | No ids → mark all read |

## Admin — `/api/admin`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/student-cancel-requests?status=` | sessions · View | |
| PATCH | `/student-cancel-requests/:id/respond` | sessions · Edit | `{ status: "accepted" \| "rejected", adminReply? }`. Accepted: the student's direct seat is removed and a live session already charged for it is refunded. The student is notified either way. |

## Live-session deduction cron (`jobs/cronServices/sessionPackageCron.ts`)

- Never charges **cancelled** sessions.
- Skips students whose cancel request for that session was **accepted** (covers students who are in the
  session through a group, whose seat can't be removed individually).
