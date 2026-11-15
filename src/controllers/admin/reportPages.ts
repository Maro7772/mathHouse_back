import { Request, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";

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
        FROM payment WHERE status = 'completed' AND isDeleted = 0 AND studentId IS NOT NULL
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
    })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

    return SuccessResponse(res, { from, to, teachers: out });
};

// GET /admin/reports/teachers/:teacherId — past sessions + ratings with comments
export const getTeacherReportDetail = async (req: Request, res: Response) => {
    const teacherId = String(req.params.teacherId || "");
    const [teacher] = await rows(sql`SELECT id, name, email FROM teachers WHERE id = ${teacherId}`);
    if (!teacher) throw new NotFound("Teacher not found");

    const sessionsList = await rows(sql`
        SELECT s.id, s.name, ${SESSION_DAY} AS day, s.time_from AS timeFrom, s.time_to AS timeTo,
               s.session_relational_type AS type, s.status, s.cancel_reason AS cancelReason,
               (SELECT COUNT(*) FROM session_attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present,
               (SELECT COUNT(*) FROM session_attendance a WHERE a.session_id = s.id) AS marked,
               (SELECT AVG(r.overall_rating) FROM session_student_ratings r WHERE r.session_id = s.id) AS avgRating
        FROM sessions s
        WHERE s.teacher_id = ${teacherId} AND ${SESSION_DAY} <= CURDATE()
        ORDER BY ${SESSION_DAY} DESC, s.time_from DESC
        LIMIT 40`);

    const reviews = await rows(sql`
        SELECT r.id, r.overall_rating AS rating, r.general_comment AS comment, r.created_at AS createdAt,
               s.name AS sessionName, CONCAT(st.first_name, ' ', st.last_name) AS studentName
        FROM session_student_ratings r
        JOIN sessions s ON s.id = r.session_id
        LEFT JOIN student st ON st.id = r.student_id
        WHERE s.teacher_id = ${teacherId}
        ORDER BY r.created_at DESC
        LIMIT 30`);

    return SuccessResponse(res, {
        teacher,
        sessions: sessionsList.map((s) => ({ ...s, present: num(s.present), marked: num(s.marked), avgRating: round1(s.avgRating) })),
        reviews: reviews.map((r) => ({ ...r, rating: num(r.rating) })),
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
        FROM payment p WHERE ${inRange} GROUP BY p.status`);
    const [pendingAll] = await rows(sql`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount FROM payment WHERE status = 'pending' AND isDeleted = 0`);

    const byMethod = await rows(sql`
        SELECT COALESCE(pm.name, 'Unknown') AS name, COUNT(*) AS n, SUM(p.amount) AS amount
        FROM payment p LEFT JOIN paymentMethod pm ON pm.id = p.paymentMethodId
        WHERE ${inRange} AND p.status = 'completed' GROUP BY pm.name ORDER BY amount DESC`);
    const byPurpose = await rows(sql`
        SELECT ${PURPOSE} AS name, COUNT(*) AS n, SUM(p.amount) AS amount
        FROM payment p WHERE ${inRange} AND p.status = 'completed' GROUP BY name ORDER BY amount DESC`);

    // Last 12 months of collected money (ignores the from/to filter on purpose).
    const monthly = await rows(sql`
        SELECT DATE_FORMAT(p.createdAt, '%Y-%m') AS month, SUM(p.amount) AS amount, COUNT(*) AS n
        FROM payment p
        WHERE p.status = 'completed' AND p.isDeleted = 0
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
        },
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
