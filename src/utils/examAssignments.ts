// utils/examAssignments.ts
// Which exams were assigned to a student by an admin, directly or through one of their groups.
import { eq, inArray } from "drizzle-orm";
import { db } from "../models/connection";
import { examStudents, examGroups } from "../models/schema/admin/exams";
import { groupStudents } from "../models/schema/admin/Groups";

export async function getAssignedExamIds(studentId: string): Promise<Set<string>> {
    const [direct, viaGroups] = await Promise.all([
        db.select({ examId: examStudents.examId }).from(examStudents).where(eq(examStudents.studentId, studentId)),
        db.select({ examId: examGroups.examId })
            .from(examGroups)
            .innerJoin(groupStudents, eq(groupStudents.groupId, examGroups.groupId))
            .where(eq(groupStudents.studentId, studentId)),
    ]);
    return new Set([...direct, ...viaGroups].map(r => r.examId));
}

export async function isExamAssigned(studentId: string, examId: string) {
    return (await getAssignedExamIds(studentId)).has(examId);
}

/** examId → { students, groups } assignment counts, for admin lists. */
export async function getAssignmentCounts(examIds: string[]) {
    const map = new Map<string, { students: number; groups: number }>();
    if (examIds.length === 0) return map;
    const [s, g] = await Promise.all([
        db.select({ examId: examStudents.examId }).from(examStudents).where(inArray(examStudents.examId, examIds)),
        db.select({ examId: examGroups.examId }).from(examGroups).where(inArray(examGroups.examId, examIds)),
    ]);
    for (const id of examIds) map.set(id, { students: 0, groups: 0 });
    s.forEach(r => map.get(r.examId)!.students++);
    g.forEach(r => map.get(r.examId)!.groups++);
    return map;
}
