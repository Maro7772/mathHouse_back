// utils/teacherSchedule.ts
// Phase B — a teacher can't be double-booked or booked outside their working hours.
// Used by Add / Edit Session (one-off and repeating), the planner, and cover (substitute) teachers.
//
// Working hours = teacher_availability (day 0 = Sunday … 6 = Saturday, from–to). A teacher who has not
// shared any hours yet is not limited by hours (only by bookings) — the admin can set hours for them.
import { sql } from "drizzle-orm";
import { db } from "../models/connection";
import { BadRequest } from "../Errors";

export type Slot = { date: string; from: string; to: string };

/** A DATE column value as YYYY-MM-DD. Typed queries return DATE columns as a Date at UTC midnight,
 *  so the UTC parts are read (correct whatever the server's time zone). Strings pass through. */
export const ymd = (v: any): string => {
    if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
    return String(v ?? "").slice(0, 10);
};
type Row = Record<string, any>;

const rowsOf = async (q: any): Promise<Row[]> => {
    const res: any = await db.execute(q);
    return (Array.isArray(res) ? res[0] : res?.rows) ?? [];
};
const toMin = (t: string) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOf = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`).getDay();
const fmtT = (t: string) => {
    const m = toMin(t), h = Math.floor(m / 60), mm = m % 60;
    return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const fmtD = (date: string) => {
    const d = new Date(`${date.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

export type SlotProblem = { slot: Slot; kind: "busy" | "off"; with?: string };
export type TeacherCheck = {
    teacherId: string;
    name: string;
    hoursShared: boolean;
    hours: { day: number; from: string; to: string }[];
    problems: SlotProblem[];
};

/**
 * Checks many teachers against many slots in two queries.
 * skipSessionIds: sessions being edited / replaced (they don't clash with themselves).
 * Ignored as bookings: cancelled sessions, and study-plan proposals the student declined (nobody in them).
 */
export async function checkTeachers(teacherIds: string[], slots: Slot[], skipSessionIds: string[] = []): Promise<TeacherCheck[]> {
    const ids = [...new Set(teacherIds.filter(Boolean))];
    if (!ids.length) return [];
    const dates = [...new Set(slots.map((s) => ymd(s.date)))];
    const inIds = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const skip = skipSessionIds.length ? sql`AND s.id NOT IN (${sql.join(skipSessionIds.map((id) => sql`${id}`), sql`, `)})` : sql``;

    const teacherRows = await rowsOf(sql`SELECT id, name FROM teachers WHERE id IN (${inIds})`);
    const booked = dates.length ? await rowsOf(sql`
        SELECT s.id, s.teacher_id AS teacherId, s.name, s.session_date AS date, s.time_from AS f, s.time_to AS t
        FROM sessions s
        WHERE s.teacher_id IN (${inIds}) AND s.status = 'scheduled'
          AND s.session_date IN (${sql.join(dates.map((d) => sql`${d}`), sql`, `)}) ${skip}
          AND NOT (NOT EXISTS (SELECT 1 FROM session_users su WHERE su.session_id = s.id)
                   AND NOT EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = s.id)
                   AND EXISTS (SELECT 1 FROM student_plan_sessions px WHERE px.session_id = s.id)
                   AND NOT EXISTS (SELECT 1 FROM student_plan_sessions px WHERE px.session_id = s.id AND px.student_response = 'pending'))`) : [];
    const hoursRows = await rowsOf(sql`SELECT teacher_id AS teacherId, day_of_week AS d, time_from AS f, time_to AS t FROM teacher_availability WHERE teacher_id IN (${inIds})`);

    return ids.map((teacherId) => {
        const name = teacherRows.find((t) => t.id === teacherId)?.name || "This teacher";
        const hours = hoursRows.filter((h) => h.teacherId === teacherId).map((h) => ({ day: Number(h.d), from: String(h.f), to: String(h.t) }));
        const mine = booked.filter((b) => b.teacherId === teacherId);
        const problems: SlotProblem[] = [];
        for (const slot of slots) {
            const d = ymd(slot.date), from = toMin(slot.from), to = toMin(slot.to);
            const clash = mine.find((b) => ymd(b.date) === d && toMin(b.f) < to && toMin(b.t) > from);
            if (clash) { problems.push({ slot, kind: "busy", with: clash.name }); continue; }
            if (hours.length && !hours.some((h) => h.day === dayOf(d) && toMin(h.from) <= from && toMin(h.to) >= to)) {
                problems.push({ slot, kind: "off" });
            }
        }
        // two slots of the same request on top of each other (e.g. a repeat that books one day twice)
        for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
            const a = slots[i], b = slots[j];
            if (a.date.slice(0, 10) === b.date.slice(0, 10) && toMin(a.from) < toMin(b.to) && toMin(b.from) < toMin(a.to)) {
                problems.push({ slot: b, kind: "busy", with: "another time in this same request" });
            }
        }
        return { teacherId, name, hoursShared: hours.length > 0, hours, problems };
    });
}

/** Short readable list of a teacher's hours, e.g. "Sun 2:00 PM–10:00 PM, Mon 6:00 PM–10:00 PM". */
export const hoursText = (hours: TeacherCheck["hours"]) =>
    [...hours].sort((a, b) => a.day - b.day || toMin(a.from) - toMin(b.from)).map((h) => `${DAY[h.day]} ${fmtT(h.from)}–${fmtT(h.to)}`).join(", ");

/** Throws a clear error when the teacher is booked or outside their hours for any slot. */
export async function assertTeacherFree(teacherId: string, slots: Slot[], skipSessionIds: string[] = []) {
    if (!teacherId || !slots.length) return;
    const [c] = await checkTeachers([teacherId], slots, skipSessionIds);
    if (!c || !c.problems.length) return;
    const busy = c.problems.filter((p) => p.kind === "busy");
    const off = c.problems.filter((p) => p.kind === "off");
    const list = (ps: SlotProblem[]) => {
        const shown = ps.slice(0, 3).map((p) => `${fmtD(p.slot.date)} ${fmtT(p.slot.from)}${p.with ? ` ("${p.with}")` : ""}`).join("; ");
        return ps.length > 3 ? `${shown} and ${ps.length - 3} more` : shown;
    };
    if (busy.length) throw new BadRequest(`${c.name} is already teaching at that time: ${list(busy)}. Pick another time or teacher.`);
    throw new BadRequest(`That is outside ${c.name}'s working hours (${hoursText(c.hours)}): ${list(off)}. Pick another time or teacher, or update their hours.`);
}

/** Every teacher's state for these slots — for the admin's teacher pickers. */
export async function teacherStatesFor(slots: Slot[], skipSessionIds: string[] = []) {
    const all = await rowsOf(sql`SELECT id FROM teachers ORDER BY name`);
    const checks = await checkTeachers(all.map((t) => t.id), slots, skipSessionIds);
    return checks.map((c) => {
        const busy = c.problems.find((p) => p.kind === "busy");
        const off = c.problems.filter((p) => p.kind === "off");
        return {
            id: c.teacherId,
            name: c.name,
            // free = can be booked; busy / off = blocked; not_shared = free but has no working hours yet
            state: busy ? "busy" : off.length ? "off" : c.hoursShared ? "free" : "not_shared",
            reason: busy ? `Teaching "${busy.with}" on ${fmtD(busy.slot.date)} ${fmtT(busy.slot.from)}`
                : off.length ? `Outside working hours on ${off.length} date${off.length === 1 ? "" : "s"} (${hoursText(c.hours)})`
                : c.hoursShared ? "" : "No working hours set",
            problems: c.problems.length,
        };
    });
}
