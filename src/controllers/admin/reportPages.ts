import { Request, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { cairoNow } from "../../utils/cairoTime";

/*
 * Admin → Reports pages (MathPortal design): Students, Courses, Teachers, Rates, Payments, Extra H.W.
 * Read-only summaries of data that already exists. Each endpoint returns everything one page needs;
 * the admin filters/sorts in the browser.
 *
 * Ratings are the session evaluation scores in `session_student_ratings.overall_rating` (1–10);
 * the UI shows them as stars (÷ 2), like the rest of the app.
 */

type Row = Record<string, any>;
const rows = async (q: SQL): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const num = (v: unknown) => (v == null ? 0 : Number(v));
const round1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

/** Same phone → country rule as the dashboard. */
function detectCountry(phone?: string | null): string {
    if (!phone) return "Egypt";
    const c = phone.replace(/[\s\-()+]/g, "");
    if (c.startsWith("20") || c.startsWith("0020") || /^01[0125]/.test(c)) return "Egypt";
    if (c.startsWith("966") || c.startsWith("00966")) return "Saudi Arabia";
    if (c.startsWith("971") || c.startsWith("00971")) return "UAE";
    if (c.startsWith("974") || c.startsWith("00974")) return "Qatar";
    if (c.startsWith("965") || c.startsWith("00965")) return "Kuwait";
    if (c.startsWith("44") || c.startsWith("0044")) return "UK";
    if (c.startsWith("1") || c.startsWith("001")) return "USA";
    return "Egypt";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD, default = this calendar month. */
function range(q: Request["query"]) {
    const now = new Date();
    const from = typeof q.from === "string" && q.from ? q.from : ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = typeof q.to === "string" && q.to ? q.to : ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const valid = (s: string) => ISO.test(s) && ymd(new Date(`${s}T00:00:00`)) === s;
    if (!valid(from) || !valid(to)) throw new BadRequest("from and to must be dates (YYYY-MM-DD)");
    if (from > to) throw new BadRequest("from must be on or before to");
    return { from, to, fromTs: `${from} 00:00:00`, toTs: `${to} 23:59:59` };
}

/** Session day = session_date for one-off sessions, start_date for repeating ones. */
const SESSION_DAY = sql.raw("COALESCE(s.session_date, s.start_date)");

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/students
// ─────────────────────────────────────────────────────────────────────────────
export const getStudentsReport = async (_req: Request, res: Response) => {
    const students = await rows(sql`
        SELECT st.id, st.first_name AS firstName, st.last_name AS lastName, st.nickname, st.email, st.phone,
               st.parent_phone AS parentPhone, st.is_verified AS isVerified,
               st.live_balance AS liveBalance, st.exam_balance AS examBalance, st.question_balance AS questionBalance,
               c.name AS categoryName, g.name AS gradeName,
               COALESCE(w.balance, 0) AS wallet
        FROM student st
        LEFT JOIN category c ON c.id = st.category
        LEFT JOIN grade g ON g.id = st.grade
        LEFT JOIN wallet w ON w.studentId = st.id`);

    const courseRows = await rows(sql`
        SELECT DISTINCT e.studentId, co.name
        FROM enrolledItems e JOIN courses co ON co.id = e.courseId
        WHERE e.status = 'active'`);
    const paidRows = await rows(sql`
        SELECT studentId, SUM(amount) AS paid, MAX(createdAt) AS lastPayment
        FROM payment WHERE status = 'completed' AND isDeleted = 0 AND studentId IS NOT NULL AND paymentMethodId <> 'wallet00-0000-4000-8000-000000000000'
        GROUP BY studentId`);
    const attendRows = await rows(sql`
        SELECT student_id AS studentId, SUM(status = 'present') AS present, SUM(status = 'absent') AS absent,
               MAX(CASE WHEN status = 'present' THEN attended_at END) AS lastAttended
        FROM session_attendance GROUP BY student_id`);
    const liveRows = await rows(sql`SELECT DISTINCT student_id AS studentId FROM session_package_deductions`);
    const groupRows = await rows(sql`
        SELECT gs.student_id AS studentId, g.id, g.name FROM group_students gs JOIN \`groups\` g ON g.id = gs.group_id`);
    // Free days from each student's latest study-plan request (day names, e.g. "Saturday")
    const freeRows = await rows(sql`
        SELECT p.student_id AS studentId, sl.day_of_week AS day, sl.specific_date AS specificDate
        FROM student_availability_plans p JOIN student_availability_slots sl ON sl.plan_id = p.id
        WHERE p.status <> 'cancelled' AND p.created_at = (SELECT MAX(p2.created_at) FROM student_availability_plans p2
            WHERE p2.student_id = p.student_id AND p2.status <> 'cancelled')`);

    const courses = new Map<string, string[]>();
    courseRows.forEach((r) => courses.set(r.studentId, [...(courses.get(r.studentId) || []), r.name]));
    const paid = new Map(paidRows.map((r) => [r.studentId, r]));
    const attend = new Map(attendRows.map((r) => [r.studentId, r]));
    const hadLive = new Set(liveRows.map((r) => r.studentId));
    const groupsOf = new Map<string, { id: string; name: string }[]>();
    groupRows.forEach((g) => groupsOf.set(g.studentId, [...(groupsOf.get(g.studentId) || []), { id: g.id, name: g.name }]));
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const freeOf = new Map<string, Set<string>>();
    freeRows.forEach((f) => {
        const day = f.day || (f.specificDate ? DAYS[new Date(f.specificDate).getDay()] : null);
        if (!day) return;
        if (!freeOf.has(f.studentId)) freeOf.set(f.studentId, new Set());
        freeOf.get(f.studentId)!.add(day);
    });

    const list = students.map((s) => {
        const a = attend.get(s.id), p = paid.get(s.id);
        const live = num(s.liveBalance);
        const usesLive = live > 0 || hadLive.has(s.id) || num(a?.present) + num(a?.absent) > 0;
        return {
            id: s.id,
            name: `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim(),
            nickname: s.nickname,
            email: s.email,
            phone: s.phone,
            country: detectCountry(s.phone || s.parentPhone),
            category: s.categoryName ?? null,
            grade: s.gradeName ?? null,
            courses: courses.get(s.id) || [],
            groups: groupsOf.get(s.id) || [],
            freeDays: freeOf.has(s.id) ? [...freeOf.get(s.id)!] : null, // null = never sent free times
            isVerified: Boolean(num(s.isVerified)),
            liveBalance: live,
            examBalance: num(s.examBalance),
            questionBalance: num(s.questionBalance),
            wallet: num(s.wallet),
            paid: num(p?.paid),
            lastPayment: p?.lastPayment ?? null,
            present: num(a?.present),
            absent: num(a?.absent),
            lastAttended: a?.lastAttended ?? null,
            // Active = 4+ live sessions left · Low = 1–3 · Empty = 0 (only for students who use live sessions)
            status: !usesLive ? "No live sessions" : live >= 4 ? "Active" : live >= 1 ? "Low" : "Empty",
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return SuccessResponse(res, { students: list });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/courses
// ─────────────────────────────────────────────────────────────────────────────
export const getCoursesReport = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT co.id, co.name, cat.name AS categoryName,
          (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = co.id) AS chapters,
          (SELECT COUNT(*) FROM lessons l WHERE l.course_id = co.id) AS lessons,
          (SELECT COUNT(DISTINCT e.studentId) FROM enrolledItems e WHERE e.courseId = co.id AND e.status = 'active') AS activeStudents,
          (SELECT COUNT(DISTINCT e.studentId) FROM enrolledItems e WHERE e.courseId = co.id) AS allStudents,
          (SELECT COUNT(*) FROM course_teachers ct WHERE ct.course_id = co.id) AS teachers,
          (SELECT MIN(p.total_price_egp) FROM prices p WHERE p.target_type = 'course' AND p.target_id = co.id) AS fromPrice
        FROM courses co LEFT JOIN category cat ON cat.id = co.category_id`);

    // Revenue: completed payments tied to the course, through what they enrolled or the package they bought.
    const revenue = await rows(sql`
        SELECT x.courseId, SUM(x.amount) AS revenue, COUNT(*) AS payments FROM (
            SELECT DISTINCT p.id, p.amount, e.courseId
            FROM payment p JOIN enrolledItems e ON e.paymentId = p.id
            WHERE p.status = 'completed' AND p.isDeleted = 0 AND e.courseId IS NOT NULL
            UNION
            SELECT p.id, p.amount, pk.course_id AS courseId
            FROM payment p JOIN packages pk ON pk.id = p.packageId
            WHERE p.status = 'completed' AND p.isDeleted = 0
        ) x GROUP BY x.courseId`);

    // Ratings of sessions that taught lessons of the course.
    const ratings = await rows(sql`
        SELECT l.course_id AS courseId, AVG(r.overall_rating) AS avgRating, COUNT(DISTINCT r.id) AS ratings
        FROM session_student_ratings r
        JOIN session_academic_info sa ON sa.session_id = r.session_id
        JOIN lessons l ON l.id = sa.lesson_id
        GROUP BY l.course_id`);

    const rev = new Map(revenue.map((r) => [r.courseId, r]));
    const rat = new Map(ratings.map((r) => [r.courseId, r]));
    const out = list.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.categoryName ?? null,
        chapters: num(c.chapters),
        lessons: num(c.lessons),
        teachers: num(c.teachers),
        activeStudents: num(c.activeStudents),
        allStudents: num(c.allStudents),
        fromPrice: c.fromPrice == null ? null : Number(c.fromPrice),
        revenue: num(rev.get(c.id)?.revenue),
        payments: num(rev.get(c.id)?.payments),
        avgRating: round1(rat.get(c.id)?.avgRating),
        ratings: num(rat.get(c.id)?.ratings),
    })).sort((a, b) => b.activeStudents - a.activeStudents || b.revenue - a.revenue);

    return SuccessResponse(res, { courses: out });
};

// ─────────────────────────────────────────────────────────────────────────────
// Teacher money: what each live session a teacher gave was worth.
//
// A student buys live packages (N sessions for X EGP, any method incl. wallet). Each session he is
// charged for (session_package_deductions 'paid') uses one session of his balance. The sessions he
// paid for are used first, in date order, at his average paid price (total paid ÷ sessions bought).
// Anything beyond what he paid for came from balance admin gave him free (a 0 EGP package, or the
// balance set by hand). Re-Explanations of attended lessons are 'free', presence with an empty
// balance is 'unpaid', and present without any charge row is "not charged" — all three earn nothing.
// ─────────────────────────────────────────────────────────────────────────────
type StudentMoney = { paid: number; bought: number; price: number | null; gifted: number };
type ChargeRow = { teacherId: string; studentId: string; sessionId: string; day: string; kind: "bought" | "gift" | "free" | "unpaid" | "uncharged" };

const DEDUCTION_JOIN = sql.raw(`d.session_id COLLATE utf8mb4_general_ci = s.id COLLATE utf8mb4_general_ci`);

async function liveMoney(): Promise<Map<string, StudentMoney>> {
    const r = await rows(sql`
        SELECT p.studentId, SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END) AS paid,
               SUM(CASE WHEN p.amount > 0 THEN pk.number ELSE 0 END) AS bought,
               SUM(CASE WHEN p.amount > 0 THEN 0 ELSE pk.number END) AS gifted
        FROM payment p JOIN packages pk ON pk.id = p.packageId
        WHERE pk.type = 'live' AND p.status = 'completed' AND p.isDeleted = 0 AND p.studentId IS NOT NULL
        GROUP BY p.studentId`);
    return new Map(r.map((x) => {
        const paid = num(x.paid), bought = num(x.bought);
        return [x.studentId, { paid, bought, gifted: num(x.gifted), price: bought ? paid / bought : null }];
    }));
}

/** Every charge (and uncharged presence) of the given teacher — or of all teachers — tagged with its kind. */
async function liveCharges(money: Map<string, StudentMoney>, teacherId?: string): Promise<ChargeRow[]> {
    // the "bought first" order needs ALL of a student's paid charges, whoever the teacher was
    const paidAll = await rows(sql`
        SELECT d.student_id AS studentId, d.session_id AS sessionId, s.teacher_id AS teacherId,
               DATE_FORMAT(${SESSION_DAY}, '%Y-%m-%d') AS day, s.status AS status
        FROM session_package_deductions d JOIN sessions s ON ${DEDUCTION_JOIN}
        WHERE d.charge_status = 'paid'
        ORDER BY d.student_id, ${SESSION_DAY}, s.time_from, d.deducted_at`);
    const out: ChargeRow[] = [];
    const used = new Map<string, number>();
    for (const c of paidAll) {
        const n = (used.get(c.studentId) || 0) + 1;
        used.set(c.studentId, n);
        if (teacherId && c.teacherId !== teacherId) continue;
        // a charge left on a cancelled session (from before cancels gave sessions back) used balance,
        // so it counts in the order above, but the teacher earns nothing for a class that didn't happen
        if (c.status === "cancelled") continue;
        const { status: _s, ...row } = c;
        out.push({ ...row, kind: n <= (money.get(c.studentId)?.bought || 0) ? "bought" : "gift" } as ChargeRow);
    }
    const byTeacher = teacherId ? sql`AND s.teacher_id = ${teacherId}` : sql``;
    const other = await rows(sql`
        SELECT d.student_id AS studentId, d.session_id AS sessionId, s.teacher_id AS teacherId,
               DATE_FORMAT(${SESSION_DAY}, '%Y-%m-%d') AS day, d.charge_status AS kind
        FROM session_package_deductions d JOIN sessions s ON ${DEDUCTION_JOIN}
        WHERE d.charge_status IN ('free', 'unpaid') AND s.status <> 'cancelled' ${byTeacher}`);
    const uncharged = await rows(sql`
        SELECT a.student_id AS studentId, a.session_id AS sessionId, s.teacher_id AS teacherId,
               DATE_FORMAT(${SESSION_DAY}, '%Y-%m-%d') AS day, 'uncharged' AS kind
        FROM session_attendance a JOIN sessions s ON s.id = a.session_id
        WHERE a.status = 'present' AND s.status <> 'cancelled' ${byTeacher}
          AND NOT EXISTS (SELECT 1 FROM session_package_deductions d
                          WHERE d.session_id COLLATE utf8mb4_general_ci = a.session_id COLLATE utf8mb4_general_ci
                            AND d.student_id COLLATE utf8mb4_general_ci = a.student_id COLLATE utf8mb4_general_ci)`);
    return [...out, ...(other as ChargeRow[]), ...(uncharged as ChargeRow[])];
}

const worth = (c: ChargeRow, money: Map<string, StudentMoney>) =>
    c.kind === "bought" ? money.get(c.studentId)?.price || 0 : 0;

/** The period of the same length right before from–to (for "vs previous period"). */
function previousRange(from: string, to: string) {
    const day = 86400000;
    const f = new Date(`${from}T00:00:00Z`).getTime(), t = new Date(`${to}T00:00:00Z`).getTime();
    const len = Math.round((t - f) / day) + 1;
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return { from: iso(f - len * day), to: iso(f - day) };
}

/** One line per session: who was booked, who came, what it earned. `where` filters `sessions s`. */
async function sessionLines(where: SQL, money: Map<string, StudentMoney>, charges: ChargeRow[]) {
    const list = await rows(sql`
        SELECT s.id, s.name, DATE_FORMAT(${SESSION_DAY}, '%Y-%m-%d') AS day,
               TIME_FORMAT(s.time_from, '%H:%i') AS timeFrom, TIME_FORMAT(s.time_to, '%H:%i') AS timeTo,
               s.session_relational_type AS type, s.status, s.cancel_reason AS cancelReason,
               s.teacher_id AS teacherId, t.name AS teacherName
        FROM sessions s LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE ${where}
        ORDER BY ${SESSION_DAY} DESC, s.time_from DESC`);
    if (!list.length) return [];
    const booked = await rows(sql`
        SELECT x.sessionId, COUNT(DISTINCT x.studentId) AS n FROM (
            SELECT su.session_id AS sessionId, su.student_id AS studentId FROM session_users su
            UNION
            SELECT sg.session_id, gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
        ) x JOIN sessions s ON s.id = x.sessionId WHERE ${where} GROUP BY x.sessionId`);
    const att = await rows(sql`
        SELECT a.session_id AS sessionId, SUM(a.status = 'present') AS present, SUM(a.status = 'absent') AS absent
        FROM session_attendance a JOIN sessions s ON s.id = a.session_id WHERE ${where} GROUP BY a.session_id`);
    const rate = await rows(sql`
        SELECT r.session_id AS sessionId, AVG(r.overall_rating) AS avgRating, COUNT(*) AS ratings
        FROM session_student_ratings r JOIN sessions s ON s.id = r.session_id WHERE ${where} GROUP BY r.session_id`);
    const B = new Map(booked.map((r) => [r.sessionId, num(r.n)]));
    const A = new Map(att.map((r) => [r.sessionId, r]));
    const R = new Map(rate.map((r) => [r.sessionId, r]));
    const M = new Map<string, { revenue: number; paid: number; free: number }>();
    charges.forEach((c) => {
        const m = M.get(c.sessionId) || { revenue: 0, paid: 0, free: 0 };
        if (c.kind === "bought") { m.paid++; m.revenue += worth(c, money); } else m.free++;
        M.set(c.sessionId, m);
    });
    const today = cairoNow().today;
    return list.map((x) => {
        const a = A.get(x.id), m = M.get(x.id), present = num(a?.present), absent = num(a?.absent);
        const bookedN = Math.max(B.get(x.id) || 0, present + absent);
        return {
            id: x.id, name: x.name, day: x.day, timeFrom: x.timeFrom, timeTo: x.timeTo, type: x.type,
            teacherId: x.teacherId, teacherName: x.teacherName ?? null, cancelReason: x.cancelReason ?? null,
            // held = scheduled and the day has passed (or is today with attendance taken)
            state: x.status === "cancelled" ? "cancelled" : x.day > today ? "upcoming" : x.day === today && !(present + absent) ? "today" : "held",
            booked: bookedN, present, absent,
            notMarked: x.status === "cancelled" ? 0 : Math.max(0, bookedN - present - absent),
            attendanceRate: present + absent ? Math.round((present / (present + absent)) * 100) : null,
            paidStudents: m?.paid || 0,
            freeStudents: m?.free || 0,
            revenue: Math.round(m?.revenue || 0),
            avgRating: round1(R.get(x.id)?.avgRating),
            ratings: num(R.get(x.id)?.ratings),
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/teachers?from&to
// ─────────────────────────────────────────────────────────────────────────────
export const getTeachersReport = async (req: Request, res: Response) => {
    const { from, to } = range(req.query);
    const list = await rows(sql`
        SELECT t.id, t.name, t.email,
          (SELECT GROUP_CONCAT(DISTINCT co.name ORDER BY co.name SEPARATOR ', ')
             FROM course_teachers ct JOIN courses co ON co.id = ct.course_id WHERE ct.teacher_id = t.id) AS courses,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'scheduled'
             AND ${SESSION_DAY} BETWEEN ${from} AND ${to}) AS sessions,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id AND s.status = 'cancelled'
             AND ${SESSION_DAY} BETWEEN ${from} AND ${to}) AS cancelled,
          (SELECT COUNT(*) FROM sessions s WHERE s.teacher_id = t.id) AS allSessions,
          (SELECT COUNT(DISTINCT a.student_id) FROM session_attendance a JOIN sessions s ON s.id = a.session_id
             WHERE s.teacher_id = t.id AND a.status = 'present' AND ${SESSION_DAY} BETWEEN ${from} AND ${to}) AS students,
          (SELECT SUM(a.status = 'present') FROM session_attendance a JOIN sessions s ON s.id = a.session_id
             WHERE s.teacher_id = t.id AND ${SESSION_DAY} BETWEEN ${from} AND ${to}) AS present,
          (SELECT COUNT(*) FROM session_attendance a JOIN sessions s ON s.id = a.session_id
             WHERE s.teacher_id = t.id AND ${SESSION_DAY} BETWEEN ${from} AND ${to}) AS marked,
          (SELECT AVG(r.overall_rating) FROM session_student_ratings r JOIN sessions s ON s.id = r.session_id
             WHERE s.teacher_id = t.id) AS avgRating,
          (SELECT COUNT(*) FROM session_student_ratings r JOIN sessions s ON s.id = r.session_id
             WHERE s.teacher_id = t.id) AS ratings
        FROM teachers t`);

    // money earned in the period (session day inside from–to)
    const money = await liveMoney();
    const charges = (await liveCharges(money)).filter((c) => c.day >= from && c.day <= to);
    const earn = new Map<string, { revenue: number; paidSessions: number; freeSessions: number }>();
    charges.forEach((c) => {
        const e = earn.get(c.teacherId) || { revenue: 0, paidSessions: 0, freeSessions: 0 };
        if (c.kind === "bought") { e.paidSessions++; e.revenue += worth(c, money); } else e.freeSessions++;
        earn.set(c.teacherId, e);
    });

    const out = list.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        courses: t.courses ? String(t.courses).split(", ") : [],
        sessions: num(t.sessions),
        cancelled: num(t.cancelled),
        allSessions: num(t.allSessions),
        students: num(t.students),
        attendanceRate: num(t.marked) ? Math.round((num(t.present) / num(t.marked)) * 100) : null,
        avgRating: round1(t.avgRating),
        ratings: num(t.ratings),
        revenue: Math.round(earn.get(t.id)?.revenue || 0),
        paidSessions: earn.get(t.id)?.paidSessions || 0,   // student-sessions paid with money
        freeSessions: earn.get(t.id)?.freeSessions || 0,   // student-sessions given free
    })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

    // previous period of the same length, for growth
    const prev = previousRange(from, to);
    const [prevS] = await rows(sql`SELECT COUNT(*) AS n FROM sessions s WHERE s.status = 'scheduled' AND ${SESSION_DAY} BETWEEN ${prev.from} AND ${prev.to}`);
    const prevCharges = (await liveCharges(money)).filter((c) => c.day >= prev.from && c.day <= prev.to);
    const [att] = await rows(sql`
        SELECT SUM(a.status = 'present') AS present FROM session_attendance a JOIN sessions s ON s.id = a.session_id
        WHERE ${SESSION_DAY} BETWEEN ${from} AND ${to}`);
    const [prevAtt] = await rows(sql`
        SELECT SUM(a.status = 'present') AS present FROM session_attendance a JOIN sessions s ON s.id = a.session_id
        WHERE ${SESSION_DAY} BETWEEN ${prev.from} AND ${prev.to}`);

    return SuccessResponse(res, {
        from, to, teachers: out,
        totals: { sessions: out.reduce((n, t) => n + t.sessions, 0), revenue: out.reduce((n, t) => n + t.revenue, 0), attendances: num(att?.present) },
        previous: {
            from: prev.from, to: prev.to,
            sessions: num(prevS?.n),
            revenue: Math.round(prevCharges.reduce((n, c) => n + worth(c, money), 0)),
            attendances: num(prevAtt?.present),
        },
    });
};

// GET /admin/reports/teachers/:teacherId — past sessions + ratings with comments
export const getTeacherReportDetail = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId || "");
    const [teacher] = await rows(sql`SELECT id, name, email FROM teachers WHERE id = ${teacherId}`);
    if (!teacher) throw new NotFound("Teacher not found");


    const reviews = await rows(sql`
        SELECT r.id, r.overall_rating AS rating, r.general_comment AS comment, r.created_at AS createdAt,
               s.name AS sessionName, CONCAT(st.first_name, ' ', st.last_name) AS studentName
        FROM session_student_ratings r
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN student st ON st.id = r.student_id
        WHERE s.teacher_id = ${teacherId}
        ORDER BY r.created_at DESC
        LIMIT 30`);

    // ── students across ALL of the teacher's sessions (booked by name, through a group, or marked) ──
    const audience = await rows(sql`
        SELECT x.studentId, COUNT(DISTINCT x.sessionId) AS booked FROM (
            SELECT su.student_id AS studentId, s.id AS sessionId FROM session_users su JOIN sessions s ON s.id = su.session_id
              WHERE s.teacher_id = ${teacherId} AND s.status = 'scheduled'
            UNION
            SELECT gs.student_id, s.id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id
              JOIN sessions s ON s.id = sg.session_id WHERE s.teacher_id = ${teacherId} AND s.status = 'scheduled'
            UNION
            SELECT a.student_id, s.id FROM session_attendance a JOIN sessions s ON s.id = a.session_id
              WHERE s.teacher_id = ${teacherId}
        ) x GROUP BY x.studentId`);
    const attendance = await rows(sql`
        SELECT a.student_id AS studentId, SUM(a.status = 'present') AS present, SUM(a.status = 'absent') AS absent,
               MAX(CASE WHEN a.status = 'present' THEN DATE_FORMAT(${SESSION_DAY}, '%Y-%m-%d') END) AS lastAttended
        FROM session_attendance a JOIN sessions s ON s.id = a.session_id
        WHERE s.teacher_id = ${teacherId} GROUP BY a.student_id`);
    const ids = audience.map((a) => a.studentId);
    const people = ids.length ? await rows(sql`
        SELECT st.id, CONCAT(st.first_name, ' ', st.last_name) AS name, st.nickname, st.phone, st.live_balance AS liveBalance
        FROM student st WHERE st.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`) : [];

    const [counts] = await rows(sql`
        SELECT SUM(s.status = 'scheduled' AND ${SESSION_DAY} <= CURDATE()) AS held,
               SUM(s.status = 'scheduled' AND ${SESSION_DAY} > CURDATE()) AS upcoming,
               SUM(s.status = 'cancelled') AS cancelled
        FROM sessions s WHERE s.teacher_id = ${teacherId}`);
    const money = await liveMoney();
    const charges = await liveCharges(money, teacherId);
    const att = new Map(attendance.map((a) => [a.studentId, a]));
    const who = new Map(people.map((p) => [p.id, p]));
    const per = new Map<string, Record<ChargeRow["kind"], number> & { revenue: number }>();
    charges.forEach((c) => {
        const p = per.get(c.studentId) || { bought: 0, gift: 0, free: 0, unpaid: 0, uncharged: 0, revenue: 0 };
        p[c.kind]++;
        p.revenue += worth(c, money);
        per.set(c.studentId, p);
    });

    // free sessions admin gave on purpose (Students → Give free sessions), with their reasons
    const grantRows = ids.length ? await rows(sql`
        SELECT student_id AS studentId, SUM(sessions) AS n, GROUP_CONCAT(DISTINCT reason ORDER BY created_at SEPARATOR ' · ') AS reasons
        FROM student_free_sessions WHERE student_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY student_id`) : [];
    const grants = new Map(grantRows.map((g) => [g.studentId, { n: num(g.n), reasons: g.reasons ? String(g.reasons) : "" }]));

    const students = audience.map((a) => {
        const p = per.get(a.studentId) || { bought: 0, gift: 0, free: 0, unpaid: 0, uncharged: 0, revenue: 0 };
        const m = money.get(a.studentId);
        const st = who.get(a.studentId);
        const freeSessions = p.gift + p.free + p.unpaid + p.uncharged;
        // why sessions were free, most important first
        const freeWhy = [
            p.gift && (grants.get(a.studentId)?.n
                ? `${p.gift} from free sessions admin gave (${grants.get(a.studentId)!.reasons})`
                : `${p.gift} from balance added without payment`),
            p.unpaid && `${p.unpaid} attended with no balance left`,
            p.uncharged && `${p.uncharged} attended but never charged`,
            p.free && `${p.free} free Re-Explanation`,
        ].filter(Boolean) as string[];
        return {
            id: a.studentId,
            name: st?.name?.trim() || "Deleted student",
            nickname: st?.nickname ?? null,
            phone: st?.phone ?? null,
            liveBalance: num(st?.liveBalance),
            booked: num(a.booked),
            present: num(att.get(a.studentId)?.present),
            absent: num(att.get(a.studentId)?.absent),
            lastAttended: att.get(a.studentId)?.lastAttended ?? null,
            livePaidTotal: Math.round(m?.paid || 0),          // everything he paid for live packages
            sessionsBought: m?.bought || 0,
            giftedByPackage: m?.gifted || 0,                   // sessions from 0 EGP packages
            freeGiven: grants.get(a.studentId)?.n || 0,         // sessions admin gave free on purpose
            freeGivenReasons: grants.get(a.studentId)?.reasons || "",
            pricePerSession: m?.price == null ? null : Math.round(m.price * 100) / 100,
            paidSessions: p.bought,
            freeSessions,
            freeWhy,
            revenue: Math.round(p.revenue),
            // "Free" = never paid for a live session but still took sessions; "Partly free" = some were free
            payStatus: !m?.bought ? (freeSessions || p.bought ? "Free" : "Nothing yet") : freeSessions ? "Partly free" : "Paid",
        };
    }).sort((x, y) => y.revenue - x.revenue || y.present - x.present || x.name.localeCompare(y.name));

    const summary = {
        students: students.length,
        attended: students.filter((s) => s.present > 0).length,
        revenue: students.reduce((n, s) => n + s.revenue, 0),
        paidSessions: students.reduce((n, s) => n + s.paidSessions, 0),
        freeSessions: students.reduce((n, s) => n + s.freeSessions, 0),
        freeStudents: students.filter((s) => s.payStatus === "Free" || s.payStatus === "Partly free").length,
        heldSessions: num(counts?.held),
        upcomingSessions: num(counts?.upcoming),
        cancelledSessions: num(counts?.cancelled),
    };
    const sessionsList = await sessionLines(sql`s.teacher_id = ${teacherId}`, money, charges);
    const held = sessionsList.filter((x) => x.state === "held");
    Object.assign(summary, {
        attendances: held.reduce((n, x) => n + x.present, 0),
        avgPerSession: (() => { const m = held.filter((x) => x.present + x.absent > 0); return m.length ? Math.round((m.reduce((n, x) => n + x.present, 0) / m.length) * 10) / 10 : null; })(),
        revenuePerSession: held.length ? Math.round(summary.revenue / held.length) : null,
        revenuePerStudent: summary.attended ? Math.round(summary.revenue / summary.attended) : null,
    });

    return SuccessResponse(res, {
        teacher,
        summary,
        students,
        sessions: sessionsList,
        reviews: reviews.map((r) => ({ ...r, rating: num(r.rating) })),
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/sessions?from&to[&teacherId] — every session in the period, all teachers
// ─────────────────────────────────────────────────────────────────────────────
export const getSessionsReport = async (req: Request, res: Response) => {
    const { from, to } = range(req.query);
    const teacherId = typeof req.query.teacherId === "string" && req.query.teacherId ? req.query.teacherId : null;
    const money = await liveMoney();
    const charges = await liveCharges(money, teacherId || undefined);
    const where = teacherId
        ? sql`${SESSION_DAY} BETWEEN ${from} AND ${to} AND s.teacher_id = ${teacherId}`
        : sql`${SESSION_DAY} BETWEEN ${from} AND ${to}`;
    const list = await sessionLines(where, money, charges);
    const held = list.filter((x) => x.state === "held");
    const marked = held.filter((x) => x.present + x.absent > 0);
    const sum = (k: "present" | "booked" | "revenue" | "freeStudents" | "paidStudents", l = held) => l.reduce((n, x) => n + x[k], 0);
    return SuccessResponse(res, {
        from, to,
        totals: {
            sessions: list.length, held: held.length,
            upcoming: list.filter((x) => x.state === "upcoming" || x.state === "today").length,
            cancelled: list.filter((x) => x.state === "cancelled").length,
            booked: sum("booked"), present: sum("present"), revenue: sum("revenue"),
            paidStudents: sum("paidStudents"), freeStudents: sum("freeStudents"),
            // average over sessions whose attendance was taken (unmarked ones would read as 0)
            avgPerSession: marked.length ? Math.round((sum("present", marked) / marked.length) * 10) / 10 : null,
            revenuePerSession: held.length ? Math.round(sum("revenue") / held.length) : null,
            // attendance taken and nobody was present / attendance never taken
            emptySessions: held.filter((x) => !x.present && x.absent > 0).length,
            unmarkedSessions: held.filter((x) => !x.present && !x.absent).length,
        },
        sessions: list,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/rates
// ─────────────────────────────────────────────────────────────────────────────
export const getRatesReport = async (_req: Request, res: Response) => {
    const [totals] = await rows(sql`
        SELECT COUNT(*) AS ratings, AVG(overall_rating) AS avgRating,
               SUM(general_comment IS NOT NULL AND TRIM(general_comment) <> '') AS comments
        FROM session_student_ratings`);

    // 1–10 scores grouped into 5 star buckets: 1–2 → 1★ … 9–10 → 5★
    const dist = await rows(sql`
        SELECT LEAST(5, GREATEST(1, CEIL(overall_rating / 2))) AS stars, COUNT(*) AS n
        FROM session_student_ratings GROUP BY stars`);

    const byCourse = await rows(sql`
        SELECT co.id, co.name, AVG(r.overall_rating) AS avgRating, COUNT(DISTINCT r.id) AS ratings
        FROM session_student_ratings r
        JOIN session_academic_info sa ON sa.session_id = r.session_id
        JOIN lessons l ON l.id = sa.lesson_id
        JOIN courses co ON co.id = l.course_id
        GROUP BY co.id, co.name ORDER BY avgRating DESC`);

    const byTeacher = await rows(sql`
        SELECT t.id, t.name, AVG(r.overall_rating) AS avgRating, COUNT(*) AS ratings
        FROM session_student_ratings r
        JOIN sessions s ON s.id = r.session_id
        JOIN teachers t ON t.id = s.teacher_id
        GROUP BY t.id, t.name ORDER BY avgRating DESC`);

    const comments = await rows(sql`
        SELECT r.id, r.overall_rating AS rating, r.general_comment AS comment, r.created_at AS createdAt,
               s.name AS sessionName, t.name AS teacherName, CONCAT(st.first_name, ' ', st.last_name) AS studentName
        FROM session_student_ratings r
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN teachers t ON t.id = s.teacher_id
        LEFT JOIN student st ON st.id = r.student_id
        WHERE r.general_comment IS NOT NULL AND TRIM(r.general_comment) <> ''
        ORDER BY r.created_at DESC LIMIT 40`);

    const pick = (r: Row) => ({ id: r.id, name: r.name, avgRating: round1(r.avgRating), ratings: num(r.ratings) });
    return SuccessResponse(res, {
        totals: { ratings: num(totals?.ratings), avgRating: round1(totals?.avgRating), comments: num(totals?.comments) },
        distribution: [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: num(dist.find((d) => num(d.stars) === s)?.n) })),
        courses: byCourse.map(pick),
        teachers: byTeacher.map(pick),
        comments: comments.map((c) => ({ ...c, rating: num(c.rating) })),
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/payments?from&to
// ─────────────────────────────────────────────────────────────────────────────
const PURPOSE = sql.raw(`CASE WHEN p.purpose = 'wallet_recharge' THEN 'Wallet top-up'
    WHEN p.packageId IS NOT NULL THEN 'Package' ELSE 'Content' END`);

export const getPaymentsReport = async (req: Request, res: Response) => {
    const { from, to, fromTs, toTs } = range(req.query);
    const inRange = sql`p.isDeleted = 0 AND p.createdAt BETWEEN ${fromTs} AND ${toTs}`;

    const byStatus = await rows(sql`
        SELECT p.status, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS amount
        FROM payment p WHERE ${inRange} AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000' GROUP BY p.status`);
    const [pendingAll] = await rows(sql`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM payment WHERE status = 'pending' AND isDeleted = 0`);

    const byMethod = await rows(sql`
        SELECT COALESCE(pm.name, 'Unknown') AS name, COUNT(*) AS n, SUM(p.amount) AS amount
        FROM payment p LEFT JOIN paymentMethod pm ON pm.id = p.paymentMethodId
        WHERE ${inRange} AND p.status = 'completed' AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000' GROUP BY pm.name ORDER BY amount DESC`);
    const byPurpose = await rows(sql`
        SELECT ${PURPOSE} AS name, COUNT(*) AS n, SUM(p.amount) AS amount
        FROM payment p WHERE ${inRange} AND p.status = 'completed' AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000' GROUP BY name ORDER BY amount DESC`);

    // Last 12 months of collected money (ignores the from/to filter on purpose).
    const monthly = await rows(sql`
        SELECT DATE_FORMAT(p.createdAt, '%Y-%m') AS month, SUM(p.amount) AS amount, COUNT(*) AS n
        FROM payment p
        WHERE p.status = 'completed' AND p.isDeleted = 0 AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000'
          AND p.createdAt >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
        GROUP BY month ORDER BY month`);
    const months: { month: string; amount: number; count: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const m = monthly.find((r) => r.month === key);
        months.push({ month: key, amount: num(m?.amount), count: num(m?.n) });
    }

    const transactions = await rows(sql`
        SELECT p.id, p.createdAt, p.amount, p.status, p.reason, ${PURPOSE} AS purpose,
               COALESCE(pm.name, '—') AS method, pk.name AS packageName,
               p.studentId, CONCAT(st.first_name, ' ', st.last_name) AS studentName
        FROM payment p
        LEFT JOIN paymentMethod pm ON pm.id = p.paymentMethodId
        LEFT JOIN packages pk ON pk.id = p.packageId
        LEFT JOIN student st ON st.id = p.studentId
        WHERE ${inRange}
        ORDER BY p.createdAt DESC LIMIT 200`);

    // 0-1-2-3 countdown: students who use live sessions and have 3 or fewer left.
    const lowBalance = await rows(sql`
        SELECT st.id, CONCAT(st.first_name, ' ', st.last_name) AS name, st.nickname, st.live_balance AS liveBalance,
               (SELECT MAX(a.attended_at) FROM session_attendance a WHERE a.student_id = st.id AND a.status = 'present') AS lastAttended,
               (SELECT GROUP_CONCAT(DISTINCT co.name ORDER BY co.name SEPARATOR ', ') FROM enrolledItems e
                  JOIN courses co ON co.id = e.courseId WHERE e.studentId = st.id AND e.status = 'active') AS courses
        FROM student st
        WHERE st.live_balance <= 3
          -- the deductions table was created with a different collation than student.id
          AND (EXISTS (SELECT 1 FROM session_package_deductions d
                       WHERE d.student_id COLLATE utf8mb4_general_ci = st.id COLLATE utf8mb4_general_ci)
               OR EXISTS (SELECT 1 FROM session_attendance a WHERE a.student_id = st.id)
               OR st.live_balance > 0)
        ORDER BY st.live_balance, st.first_name, st.last_name`);

    const [walletTotal] = await rows(sql`SELECT COALESCE(SUM(balance), 0) AS total, SUM(balance > 0) AS n FROM wallet`);

    // same-length period right before, for growth; plus first-time vs returning payers in the period
    const prev = previousRange(from, to);
    const [prevTot] = await rows(sql`
        SELECT COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS amount FROM payment p
        WHERE p.isDeleted = 0 AND p.status = 'completed' AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000'
          AND p.createdAt BETWEEN ${prev.from + " 00:00:00"} AND ${prev.to + " 23:59:59"}`);
    const [payers] = await rows(sql`
        SELECT COUNT(DISTINCT p.studentId) AS payers,
               COUNT(DISTINCT CASE WHEN NOT EXISTS (SELECT 1 FROM payment p2 WHERE p2.studentId = p.studentId AND p2.status = 'completed'
                    AND p2.isDeleted = 0 AND p2.createdAt < ${fromTs}) THEN p.studentId END) AS newPayers
        FROM payment p
        WHERE ${inRange} AND p.status = 'completed' AND p.studentId IS NOT NULL AND p.paymentMethodId <> 'wallet00-0000-4000-8000-000000000000'`);

    const status = (s: string) => byStatus.find((r) => r.status === s);
    return SuccessResponse(res, {
        from, to,
        totals: {
            collected: num(status("completed")?.amount),
            collectedCount: num(status("completed")?.n),
            pendingInRange: num(status("pending")?.amount),
            rejected: num(status("rejected")?.amount),
            rejectedCount: num(status("rejected")?.n),
            pendingNow: num(pendingAll?.amount),
            pendingNowCount: num(pendingAll?.n),
            walletBalances: num(walletTotal?.total),
            walletsWithBalance: num(walletTotal?.n),
            avgOrder: num(status("completed")?.n) ? Math.round(num(status("completed")?.amount) / num(status("completed")?.n)) : null,
            payers: num(payers?.payers),
            newPayers: num(payers?.newPayers),
        },
        previous: { from: prev.from, to: prev.to, collected: num(prevTot?.amount), collectedCount: num(prevTot?.n) },
        byMethod: byMethod.map((r) => ({ name: r.name, count: num(r.n), amount: num(r.amount) })),
        byPurpose: byPurpose.map((r) => ({ name: r.name, count: num(r.n), amount: num(r.amount) })),
        months,
        transactions: transactions.map((t) => ({ ...t, amount: num(t.amount) })),
        lowBalance: lowBalance.map((s) => ({ ...s, liveBalance: num(s.liveBalance), courses: s.courses ? String(s.courses).split(", ") : [] })),
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/homework
// ─────────────────────────────────────────────────────────────────────────────
export const getHomeworkReport = async (_req: Request, res: Response) => {
    const sets = await rows(sql`
        SELECT h.id, h.title, h.due_date AS dueDate, h.target_type AS targetType, h.created_at AS createdAt,
               COALESCE(c.name, g.name, gr.name) AS targetName,
               COUNT(hs.id) AS assigned,
               SUM(hs.status <> 'assigned') AS submitted,
               SUM(hs.status <> 'assigned' AND h.due_date IS NOT NULL AND hs.submitted_at > h.due_date) AS late,
               SUM(hs.score IS NOT NULL) AS graded,
               AVG(hs.score) AS avgScore
        FROM extra_homework h
        LEFT JOIN extra_homework_students hs ON hs.homework_id = h.id
        LEFT JOIN category c ON c.id = h.target_category_id
        LEFT JOIN grade g ON g.id = h.target_grade_id
        LEFT JOIN \`groups\` gr ON gr.id = h.target_group_id
        GROUP BY h.id, h.title, h.due_date, h.target_type, h.created_at, c.name, g.name, gr.name
        ORDER BY COALESCE(h.due_date, h.created_at) DESC`);

    const students = await rows(sql`
        SELECT st.id, CONCAT(st.first_name, ' ', st.last_name) AS name, st.nickname,
               COUNT(hs.id) AS assigned,
               SUM(hs.status <> 'assigned') AS submitted,
               SUM(hs.status = 'assigned' AND h.due_date IS NOT NULL AND h.due_date < NOW()) AS missed,
               SUM(hs.status <> 'assigned' AND h.due_date IS NOT NULL AND hs.submitted_at > h.due_date) AS late,
               SUM(hs.score IS NOT NULL) AS graded,
               AVG(hs.score) AS avgScore
        FROM extra_homework_students hs
        JOIN extra_homework h ON h.id = hs.homework_id
        JOIN student st ON st.id = hs.student_id
        GROUP BY st.id, st.first_name, st.last_name, st.nickname
        ORDER BY AVG(hs.score) IS NULL, AVG(hs.score) DESC, name`); // MariaDB: an aggregate's alias can't be used inside an ORDER BY expression

    const n = (r: Row) => ({
        assigned: num(r.assigned), submitted: num(r.submitted), late: num(r.late),
        graded: num(r.graded), avgScore: round1(r.avgScore),
    });
    return SuccessResponse(res, {
        sets: sets.map((s) => ({
            id: s.id, title: s.title, dueDate: s.dueDate, createdAt: s.createdAt,
            targetType: s.targetType, targetName: s.targetName ?? null, ...n(s),
        })),
        students: students.map((s) => ({ id: s.id, name: s.name, nickname: s.nickname, missed: num(s.missed), ...n(s) })),
    });
};
