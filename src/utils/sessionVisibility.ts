// utils/sessionVisibility.ts
// Who sees a session (Phase A — study-plan approval flow).
//
//  Teacher: a session appears on the teacher's dashboard only when it really has someone in it.
//   - A study-plan session the admin proposed is hidden until the student accepts it
//     (accepting adds the student to session_users).
//   - A proposal the student declined stays hidden (the plan went back to the admin to reschedule).
//   - A session whose last student cancelled (request accepted by the admin) is cancelled and hidden.
//   Sessions the admin created directly (not from a plan) keep showing as before, even before students
//   are added, unless they were cancelled with nobody in them.
//
//  Student: a session the student asked to cancel — and the admin accepted — is gone for them,
//   also when they are in it through a group (the group stays, only this student is excluded).
import { sql, SQL } from "drizzle-orm";
import { sessions } from "../models/schema/admin/Session";

/** SQL condition on `sessions`: true when the session has nobody in it (no direct student, no group). */
export const sessionHasNobody = (sessionId: SQL | any = sessions.id) => sql`(
    NOT EXISTS (SELECT 1 FROM session_users su_v WHERE su_v.session_id = ${sessionId})
    AND NOT EXISTS (SELECT 1 FROM session_groups sg_v WHERE sg_v.session_id = ${sessionId}))`;

/** SQL condition on `sessions`: the teacher may see this session. */
export const teacherCanSeeSession = (sessionId: SQL | any = sessions.id, status: SQL | any = sessions.status) => sql`NOT (
    ${sessionHasNobody(sessionId)}
    AND (${status} = 'cancelled'
         OR EXISTS (SELECT 1 FROM student_plan_sessions ps_v WHERE ps_v.session_id = ${sessionId})))`;

/** SQL condition: this student did not get an accepted cancel request for the session. */
export const notCancelledByStudent = (studentId: string | SQL | any, sessionId: SQL | any = sessions.id) => sql`NOT EXISTS (
    SELECT 1 FROM student_cancel_requests cr_v
    WHERE cr_v.session_id = ${sessionId} AND cr_v.student_id = ${studentId} AND cr_v.status = 'accepted')`;
