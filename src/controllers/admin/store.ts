// controllers/admin/store.ts
// Admin → Store → Courses: every price of a course in one place (the course, each chapter, each lesson),
// with bulk tools. Prices stay per item and in EGP (+ USD) exactly as checkout uses them today.
// Plans are always saved with syncPricePlans so enrolments that point at a plan are never lost.
import { Request, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { syncPricePlans, PlanInput } from "../../utils/pricePlans";

type Row = Record<string, any>;
type Target = { type: "course" | "chapter" | "lesson"; id: string };
const rows = async (q: SQL): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const plan = (p: Row) => ({
    id: p.id, label: p.durationLabel, days: Number(p.durationDays),
    priceEgp: Number(p.priceEgp), priceUsd: Number(p.priceUsd),
    hasDiscount: Boolean(Number(p.hasDiscount)), discountEgp: Number(p.discountEgp || 0), discountUsd: Number(p.discountUsd || 0),
    totalEgp: Number(p.totalEgp), totalUsd: Number(p.totalUsd), isDefault: Boolean(Number(p.isDefault)),
    enrolments: Number(p.enrolments || 0),
});
const PLAN_COLS = sql.raw(`p.id, p.target_type AS targetType, p.target_id AS targetId, p.duration_label AS durationLabel,
    p.duration_days AS durationDays, p.price_egp AS priceEgp, p.price_usd AS priceUsd, p.has_discount AS hasDiscount,
    p.discount_egp AS discountEgp, p.discount_usd AS discountUsd, p.total_price_egp AS totalEgp, p.total_price_usd AS totalUsd,
    p.is_default AS isDefault, (SELECT COUNT(*) FROM enrolledItems e WHERE e.priceId = p.id) AS enrolments`);

// GET /admin/store/courses — every course with its price coverage
export const listStoreCourses = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT co.id, co.name, cat.name AS category,
          (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = co.id) AS chapters,
          (SELECT COUNT(*) FROM lessons l WHERE l.course_id = co.id) AS lessons,
          (SELECT COUNT(DISTINCT ch.id) FROM chapters ch JOIN prices p ON p.target_type = 'chapter' AND p.target_id = ch.id WHERE ch.course_id = co.id) AS pricedChapters,
          (SELECT COUNT(DISTINCT l.id) FROM lessons l JOIN prices p ON p.target_type = 'lesson' AND p.target_id = l.id WHERE l.course_id = co.id) AS pricedLessons,
          (SELECT COUNT(DISTINCT e.studentId) FROM enrolledItems e WHERE e.courseId = co.id AND e.status = 'active') AS students
        FROM courses co LEFT JOIN category cat ON cat.id = co.category_id ORDER BY co.name`);
    const coursePlans = await rows(sql`SELECT ${PLAN_COLS} FROM prices p WHERE p.target_type = 'course'`);
    return SuccessResponse(res, {
        courses: list.map((c) => {
            const plans = coursePlans.filter((p) => p.targetId === c.id).map(plan).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.days - b.days);
            return {
                id: c.id, name: c.name, category: c.category,
                chapters: Number(c.chapters), lessons: Number(c.lessons), students: Number(c.students),
                pricedChapters: Number(c.pricedChapters), pricedLessons: Number(c.pricedLessons),
                plans,
                fromEgp: plans.length ? Math.min(...plans.map((p) => p.totalEgp)) : null,
            };
        }),
    });
};

// GET /admin/store/courses/:courseId — the course, its chapters and lessons, each with its plans
export const getStoreCourse = async (req: Request, res: Response) => {
    const courseId = String(req.params.courseId);
    const [course] = await rows(sql`SELECT co.id, co.name, cat.name AS category FROM courses co LEFT JOIN category cat ON cat.id = co.category_id WHERE co.id = ${courseId}`);
    if (!course) throw new NotFound("Course not found");
    const chapterList = await rows(sql`SELECT id, name FROM chapters WHERE course_id = ${courseId}
        ORDER BY COALESCE(\`order\`, 9999), created_at`);
    const lessonList = await rows(sql`SELECT id, name, chapter_id AS chapterId FROM lessons WHERE course_id = ${courseId}
        ORDER BY COALESCE(\`order\`, 9999), created_at`);
    const ids = [courseId, ...chapterList.map((c) => c.id), ...lessonList.map((l) => l.id)];
    const planRows = await rows(sql`SELECT ${PLAN_COLS} FROM prices p WHERE p.target_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    const plansOf = (type: string, id: string) => planRows.filter((p) => p.targetType === type && p.targetId === id).map(plan)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.days - b.days);
    return SuccessResponse(res, {
        course: { ...course, plans: plansOf("course", courseId) },
        chapters: chapterList.map((ch) => ({
            id: ch.id, name: ch.name, plans: plansOf("chapter", ch.id),
            lessons: lessonList.filter((l) => l.chapterId === ch.id).map((l) => ({ id: l.id, name: l.name, plans: plansOf("lesson", l.id) })),
        })),
    });
};

/** Every target must exist; returns them unchanged. */
async function checkTargets(targets: Target[]) {
    for (const type of ["course", "chapter", "lesson"] as const) {
        const ids = [...new Set(targets.filter((t) => t.type === type).map((t) => t.id))];
        if (!ids.length) continue;
        const table = sql.raw(type === "course" ? "courses" : type === "chapter" ? "chapters" : "lessons");
        const found = await rows(sql`SELECT id FROM ${table} WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        if (found.length !== ids.length) throw new BadRequest(`One or more ${type}s were not found`);
    }
}

// PUT /admin/store/prices/:type/:id { plans } — the plans of one item
export const savePlans = async (req: Request, res: Response) => {
    const target = { type: req.params.type, id: String(req.params.id) } as Target;
    if (!["course", "chapter", "lesson"].includes(target.type)) throw new BadRequest("type must be course, chapter or lesson");
    await checkTargets([target]);
    const result = await db.transaction((tx) => syncPricePlans(tx as any, target.type, target.id, req.body.plans as PlanInput[]));
    return SuccessResponse(res, { message: "Prices saved", ...result });
};

// POST /admin/store/prices/apply { targets, plans } — give many items the same plans (plans with the same
// label + days keep their ids, so their enrolments stay linked)
export const applyPlans = async (req: Request, res: Response) => {
    const { targets, plans } = req.body as { targets: Target[]; plans: PlanInput[] };
    await checkTargets(targets);
    const clean = plans.map(({ id: _id, ...p }) => p); // ids belong to one item, never copy them
    let removed = 0;
    await db.transaction(async (tx) => {
        for (const t of targets) removed += (await syncPricePlans(tx as any, t.type, t.id, clean)).removed;
    });
    return SuccessResponse(res, { message: `Prices applied to ${targets.length} item${targets.length === 1 ? "" : "s"}`, updated: targets.length, plansRemoved: removed });
};

// POST /admin/store/prices/adjust { targets, percent, currency: egp|usd|both, roundTo } — raise / lower prices
export const adjustPrices = async (req: Request, res: Response) => {
    const { targets, percent, currency, roundTo } = req.body as { targets: Target[]; percent: number; currency: "egp" | "usd" | "both"; roundTo: number };
    await checkTargets(targets);
    const factor = 1 + percent / 100;
    const r = Math.max(0.01, roundTo);
    const where = sql.join(targets.map((t) => sql`(target_type = ${t.type} AND target_id = ${t.id})`), sql` OR `);
    // `roundTo` is an EGP step (e.g. nearest 5 EGP); USD prices are small, so they keep exact cents.
    const set = (col: string) => col.endsWith("_usd")
        ? sql.raw(`${col} = GREATEST(0, ROUND(${col} * ${factor}, 2))`)
        : sql.raw(`${col} = GREATEST(0, ROUND(${col} * ${factor} / ${r}) * ${r})`);
    const parts = [
        ...(currency !== "usd" ? [set("price_egp"), set("discount_egp")] : []),
        ...(currency !== "egp" ? [set("price_usd"), set("discount_usd")] : []),
    ];
    const res2: any = await db.execute(sql`UPDATE prices SET ${sql.join(parts, sql`, `)} WHERE ${where}`);
    // A discount can never be more than the price.
    await db.execute(sql`UPDATE prices SET discount_egp = LEAST(discount_egp, price_egp), discount_usd = LEAST(discount_usd, price_usd) WHERE ${where}`);
    const changed = Number((Array.isArray(res2) ? res2[0] : res2)?.affectedRows ?? 0);
    return SuccessResponse(res, { message: `${changed} plan${changed === 1 ? "" : "s"} updated`, plansUpdated: changed });
};

// GET /admin/courses/catalog — Courses → Categories ("Courses & content", MathPortal design):
// every course with its category path, grades, teachers and content readiness.
export const getCatalogOverview = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT co.id, co.name, co.description, co.image, co.category_id AS categoryId, co.is_have_semester AS hasSemesters,
               c.name AS categoryName, c.parent_category_id AS parentId, p.name AS parentName,
          (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = co.id) AS chapters,
          (SELECT COUNT(*) FROM lessons l WHERE l.course_id = co.id) AS lessons,
          (SELECT COUNT(*) FROM lessons l WHERE l.course_id = co.id AND l.session_pdf IS NOT NULL AND l.session_pdf <> ''
              AND l.session_answers_pdf IS NOT NULL AND l.session_answers_pdf <> '') AS lessonsReady,
          (SELECT COUNT(*) FROM lesson_ideas i JOIN lessons l ON l.id = i.lesson_id WHERE l.course_id = co.id) AS ideas,
          (SELECT COUNT(DISTINCT e.studentId) FROM enrolledItems e WHERE e.courseId = co.id AND e.status = 'active') AS students
        FROM courses co
        LEFT JOIN category c ON c.id = co.category_id
        LEFT JOIN category p ON p.id = c.parent_category_id
        ORDER BY p.name, c.name, co.name`);
    const teacherRows = await rows(sql`
        SELECT ct.course_id AS courseId, t.id, t.name, t.avatar FROM course_teachers ct JOIN teachers t ON t.id = ct.teacher_id`);
    const gradeRows = await rows(sql`
        SELECT g.id, g.name, g.category_id AS categoryId, c.name AS categoryName, p.name AS parentName
        FROM grade g LEFT JOIN category c ON c.id = g.category_id LEFT JOIN category p ON p.id = g.parent_category_id`);
    const out = list.map((c) => ({
        id: c.id, name: c.name, description: c.description, image: c.image, hasSemesters: Boolean(Number(c.hasSemesters)),
        categoryId: c.categoryId, categoryName: c.categoryName, parentId: c.parentId, parentName: c.parentName,
        chapters: Number(c.chapters), lessons: Number(c.lessons), lessonsReady: Number(c.lessonsReady),
        ideas: Number(c.ideas), students: Number(c.students),
        teachers: teacherRows.filter((t) => t.courseId === c.id).map((t) => ({ id: t.id, name: t.name, avatar: t.avatar })),
        grades: gradeRows.filter((g) => g.categoryId === c.categoryId || g.categoryId === c.parentId).map((g) => ({ id: g.id, name: g.name })),
    }));
    const sum = (k: "lessons" | "lessonsReady" | "ideas") => out.reduce((a, c) => a + c[k], 0);
    return SuccessResponse(res, {
        totals: { courses: out.length, lessons: sum("lessons"), lessonsReady: sum("lessonsReady"), ideas: sum("ideas") },
        courses: out,
        grades: gradeRows.map((g) => ({ id: g.id, name: g.name, categoryId: g.categoryId, categoryName: g.categoryName, parentName: g.parentName,
            courses: out.filter((c) => c.grades.some((x) => x.id === g.id)).length })),
    });
};

// GET /admin/groups/overview — groups with the course, teacher, days and usual time taken from their
// sessions (groups themselves only store a name, status and students). Live → Groups, MathPortal design.
export const getGroupsOverview = async (_req: Request, res: Response) => {
    const groups = await rows(sql`
        SELECT g.id, g.name, g.is_active AS isActive, g.created_at AS createdAt,
               (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = g.id) AS students
        FROM \`groups\` g ORDER BY g.created_at DESC`);
    const members = await rows(sql`
        SELECT gs.group_id AS groupId, CONCAT(st.first_name, ' ', st.last_name) AS name
        FROM group_students gs JOIN student st ON st.id = gs.student_id`);
    // Sessions of each group from 30 days ago onwards (the group's current routine)
    const sess = await rows(sql`
        SELECT sg.group_id AS groupId, s.session_date AS day, s.time_from AS timeFrom, s.time_to AS timeTo,
               t.name AS teacher,
               (SELECT co.name FROM session_academic_info sa JOIN lessons l ON l.id = sa.lesson_id JOIN courses co ON co.id = l.course_id
                  WHERE sa.session_id = s.id LIMIT 1) AS course
        FROM session_groups sg JOIN sessions s ON s.id = sg.session_id LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE s.status = 'scheduled' AND s.session_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`);
    const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const top = (arr: (string | null)[]) => {
        const m = new Map<string, number>();
        arr.filter(Boolean).forEach((x) => m.set(x as string, (m.get(x as string) || 0) + 1));
        return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    };
    return SuccessResponse(res, {
        groups: groups.map((g) => {
            const ss = sess.filter((s) => s.groupId === g.id);
            const days = [...new Set(ss.map((s) => new Date(s.day).getDay()))].sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7)).map((d) => DAY[d]);
            const slot = top(ss.map((s) => `${String(s.timeFrom).slice(0, 5)}-${String(s.timeTo).slice(0, 5)}`))[0];
            return {
                id: g.id, name: g.name, isActive: Boolean(Number(g.isActive)), createdAt: g.createdAt,
                students: Number(g.students),
                studentNames: members.filter((m) => m.groupId === g.id).map((m) => m.name),
                course: top(ss.map((s) => s.course))[0] || null,
                teacher: top(ss.map((s) => s.teacher))[0] || null,
                days,
                timeFrom: slot ? slot.split("-")[0] : null,
                timeTo: slot ? slot.split("-")[1] : null,
                sessions: ss.length,
            };
        }),
    });
};

// GET /admin/session-ratings/overview — every held session (up to today) with its rating summary.
// Live → Session Ratings list (MathPortal design). Scores are 1–10; the admin shows stars out of 5.
export const getSessionRatingsOverview = async (_req: Request, res: Response) => {
    const list = await rows(sql`
        SELECT s.id, s.name, s.session_date AS day, s.time_from AS timeFrom, s.time_to AS timeTo,
               s.session_relational_type AS type, t.id AS teacherId, t.name AS teacherName,
          (SELECT AVG(r.overall_rating) FROM session_student_ratings r WHERE r.session_id = s.id) AS avgRating,
          (SELECT COUNT(*) FROM session_student_ratings r WHERE r.session_id = s.id) AS rated,
          (SELECT COUNT(*) FROM session_student_ratings r WHERE r.session_id = s.id AND r.general_comment IS NOT NULL AND TRIM(r.general_comment) <> '') AS comments,
          (SELECT COUNT(*) FROM (SELECT su.student_id FROM session_users su WHERE su.session_id = s.id
              UNION SELECT gs.student_id FROM session_groups sg JOIN group_students gs ON gs.group_id = sg.group_id WHERE sg.session_id = s.id) x) AS students
        FROM sessions s LEFT JOIN teachers t ON t.id = s.teacher_id
        WHERE s.status = 'scheduled' AND s.session_date <= CURDATE()
        ORDER BY s.session_date DESC, s.time_from DESC
        LIMIT 1000`);
    const ymd = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d).slice(0, 10));
    const out = list.map((s) => ({
        id: s.id, name: s.name, day: ymd(s.day), timeFrom: String(s.timeFrom).slice(0, 5), timeTo: String(s.timeTo).slice(0, 5),
        type: s.type, teacherId: s.teacherId, teacherName: s.teacherName,
        avgRating: s.avgRating == null ? null : Math.round(Number(s.avgRating) * 10) / 10,
        rated: Number(s.rated), comments: Number(s.comments), students: Number(s.students),
    }));
    const rated = out.filter((s) => s.rated > 0);
    const totalRated = rated.reduce((a, s) => a + s.rated, 0);
    return SuccessResponse(res, {
        totals: {
            avgRating: totalRated ? Math.round((rated.reduce((a, s) => a + (s.avgRating || 0) * s.rated, 0) / totalRated) * 10) / 10 : null,
            sessionsRated: rated.length, sessions: out.length, studentsRated: totalRated,
            comments: out.reduce((a, s) => a + s.comments, 0),
            followUp: rated.filter((s) => (s.avgRating || 0) <= 7).length, // 3.5★ or less
        },
        sessions: out,
    });
};
