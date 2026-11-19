// Admin → Exams → Assign: give an exam to students and/or groups.
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../models/connection";
import { Exams, examStudents, examGroups } from "../../models/schema/admin/exams";
import { Student } from "../../models/schema/admin/Student";
import { groups, groupStudents } from "../../models/schema/admin/Groups";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";

const uniqueStrings = (v: unknown) =>
    Array.from(new Set((Array.isArray(v) ? v : []).filter(x => typeof x === "string" && x.trim()).map(x => x.trim())));

async function findExam(id: string) {
    const [exam] = await db.select({ id: Exams.id, title: Exams.title }).from(Exams).where(eq(Exams.id, id));
    if (!exam) throw new NotFound("Exam not found");
    return exam;
}

/** GET /api/admin/exams/:id/assignments → { exam, students: [{id,name,email}], groups: [{id,name,members}] } */
export const getExamAssignments = async (req: Request, res: Response) => {
    const exam = await findExam(req.params.id);
    const [students, groupRows] = await Promise.all([
        db.select({ id: Student.id, firstname: Student.firstname, lastname: Student.lastname, nickname: Student.nickname, email: Student.email })
            .from(examStudents)
            .innerJoin(Student, eq(Student.id, examStudents.studentId))
            .where(eq(examStudents.examId, exam.id)),
        db.select({ id: groups.id, name: groups.name, members: sql<number>`(SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = ${groups.id})` })
            .from(examGroups)
            .innerJoin(groups, eq(groups.id, examGroups.groupId))
            .where(eq(examGroups.examId, exam.id)),
    ]);
    // every group, so the admin can pick from them without needing a separate permission
    const allGroups = await db
        .select({ id: groups.id, name: groups.name, members: sql<number>`(SELECT COUNT(*) FROM group_students gs WHERE gs.group_id = ${groups.id})` })
        .from(groups)
        .orderBy(groups.name);
    return SuccessResponse(res, {
        exam,
        allGroups: allGroups.map(g => ({ id: g.id, name: g.name, members: Number(g.members) || 0 })),
        students: students.map(s => ({ id: s.id, name: `${s.firstname} ${s.lastname}`.trim(), nickname: s.nickname, email: s.email })),
        groups: groupRows.map(g => ({ id: g.id, name: g.name, members: Number(g.members) || 0 })),
    });
};

/** PUT /api/admin/exams/:id/assignments  { studentIds: [], groupIds: [] } — replaces the exam's assignment list. */
export const saveExamAssignments = async (req: Request, res: Response) => {
    const exam = await findExam(req.params.id);
    const studentIds = uniqueStrings(req.body?.studentIds);
    const groupIds = uniqueStrings(req.body?.groupIds);

    if (studentIds.length) {
        const found = await db.select({ id: Student.id }).from(Student).where(inArray(Student.id, studentIds));
        if (found.length !== studentIds.length) throw new BadRequest("Some students were not found");
    }
    if (groupIds.length) {
        const found = await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, groupIds));
        if (found.length !== groupIds.length) throw new BadRequest("Some groups were not found");
    }

    const adminId = (req as any).user?.id ?? null;
    await db.transaction(async (tx) => {
        await tx.delete(examStudents).where(eq(examStudents.examId, exam.id));
        await tx.delete(examGroups).where(eq(examGroups.examId, exam.id));
        if (studentIds.length) {
            await tx.insert(examStudents).values(studentIds.map(studentId => ({ id: randomUUID(), examId: exam.id, studentId, assignedBy: adminId })));
        }
        if (groupIds.length) {
            await tx.insert(examGroups).values(groupIds.map(groupId => ({ id: randomUUID(), examId: exam.id, groupId, assignedBy: adminId })));
        }
    });

    // how many different students can now see it
    const groupMembers = groupIds.length
        ? await db.select({ studentId: groupStudents.studentId }).from(groupStudents).where(inArray(groupStudents.groupId, groupIds))
        : [];
    const reach = new Set([...studentIds, ...groupMembers.map(r => r.studentId)]).size;

    return SuccessResponse(res, {
        message: "Exam assignment saved",
        students: studentIds.length,
        groups: groupIds.length,
        reach,
    });
};
