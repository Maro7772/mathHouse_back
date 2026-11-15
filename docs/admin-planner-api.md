# Admin Planner API

Backend for **Live → Planner** in the admin (MathPortal design: *Timetable*, *Add session*, *Build a plan*).
Controller: `src/controllers/admin/planner.ts` · Routes: `src/routes/admin/planner.ts` · Validation: `src/validation/admin/planner.ts`.

- Base path: `/api/admin/planner` · admin token · `{ success, data }` envelope.
- Permissions: `sessions` View/Add/Edit; building a plan needs `availability_plans` Edit.
- Dates `YYYY-MM-DD`, times `HH:mm` (seconds allowed). Every session row is one dated occurrence
  (`session_date`), the same way the existing session form stores repeating sessions.
- Migration **0021_planner** adds `sessions.confirmed_at` and `sessions.confirmed_by` (dispatch).

## The flow
1. Students send free times (existing study-plan request, `student_availability_plans` + `_slots`).
2. The admin **builds a plan** in those free times (new sessions, proposed to the student) or **adds a
   session** directly for students/groups. Only teachers who are not booked can be used; the free-time
   finder shows who is free.
3. The student accepts/rejects proposed sessions in the student app (existing flow: on accept they are
   added to the session). The admin can also **approve** a proposed session on the student's behalf.
4. On the **timetable**, approved sessions are **dispatched**: they get `confirmed_at` and every student
   (direct + group members) and the teacher receive one notification listing their confirmed sessions.

## Endpoints

| Method | Path | What |
| --- | --- | --- |
| GET | `/timetable?from&to` | Sessions in a range (max 62 days) |
| GET | `/options[?studentId]` | Courses, groups, and the student's active course ids |
| GET | `/courses/:courseId/lessons` | Chapters with lessons, in course order |
| GET | `/free?date&timeFrom&timeTo[&courseId][&skipSessionId][&skipPlanId]` | Who is free |
| POST | `/sessions` | Add one session (approved right away) |
| POST | `/plans/:planId/build` | Create sessions in a plan's free times and propose them |
| POST | `/sessions/:id/approve` | Accept a proposed plan session for the student |
| POST | `/dispatch` | Confirm approved sessions + notify |

### GET /timetable
`data`: `{ from, to, sessions[] }`, each session:
```
{ id, name, date, timeFrom, timeTo, type,            // type: Explanation | Re-Explanation | Mistakes | Exam
  status,                                            // scheduled | cancelled
  cancelReason, confirmedAt,                         // confirmedAt = dispatched at (null = not yet)
  teacher: { id, name },
  students: [{ id, name }],                          // added directly
  groups: [{ id, name, size }],
  plans: [{ planId, title, studentId, studentName, response }],   // response: pending | accepted | rejected
  studentCount, course, lessons: [name],
  approval }                                         // approved | pending (student hasn't answered) | changes (student rejected)
```

### GET /options
`data`: `{ courses: [{ id, name, category }], groups: [{ id, name, size }], studentCourseIds: [id] }`.

### GET /courses/:courseId/lessons
`data`: `{ chapters: [{ id, name, lessons: [{ id, name }] }] }`.

### GET /free
`data`: `{ date, timeFrom, timeTo, teachers[], students[] }`
- `teachers[]`: `{ id, name, teachesCourse, state, busyWith }` —
  `state`: `free` (inside the hours the teacher shared) · `off` (shared hours, but not this time) ·
  `not_shared` (the teacher never shared availability — allowed, just unknown) · `busy` (`busyWith` = the session name).
- `students[]` (only with `courseId`; students with an active enrolment in the course):
  `{ id, name, nickname, liveBalance, state }` — `free` (inside the free times of their latest study-plan request) ·
  `off` (sent free times, not this one) · `unknown` (never sent free times) · `busy` (in another session, incl. pending proposals).
- `skipSessionId` ignores one session (moving it). `skipPlanId` ignores the sessions of that plan's current proposal
  (they are replaced when the plan is rebuilt) — pass it from the plan builder.

### POST /sessions
```
{ courseId, date, timeFrom, timeTo, teacherId, type, lessonIds: [id], name?, studentIds: [id], groupIds: [id] }
```
- At least one student or group; lessons required unless `type` = `Exam`; lessons must belong to the course.
- `400` when the teacher already teaches at that time. `name` defaults to the lesson names.
- `201` → `{ message, sessionId }`. No links/PDFs are set — add them later on the normal Edit session page.

### POST /plans/:planId/build
```
{ courseId, adminNotes?, items: [{ date, timeFrom, timeTo, teacherId, type, lessonIds: [id], name? }] }   // 1–60 items
```
- Plan must not be `cancelled` or `accepted`. Teachers can't be double-booked (also checked between items).
- Replaces the plan's current proposal; sessions that existed only for that proposal are deleted.
- Sets the plan to `plan_proposed`, links the new sessions as `pending`, notifies the student.
- `201` → `{ message, planId, sessionIds, removedEarlier }`.

### POST /sessions/:id/approve
Marks the session `accepted` on every open plan that proposed it, adds the student to the session,
notifies them; a plan with no pending sessions left (and at least one accepted) becomes `accepted`.
`400` if the session is not waiting for an answer.

### POST /dispatch
`{ sessionIds: [id] }` → dispatches those that are scheduled, today or later, not yet dispatched and not waiting
for a student. `400` if none qualify. → `{ dispatched, skipped, studentsNotified, teachersNotified }`.
