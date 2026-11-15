import { Router } from "express";
import {
    getStudentQuizReports,
    getStudentExamReports,
    getStudentDiagnosticExamReports
} from "../../controllers/admin/reports";
import {
    getStudentsReport, getCoursesReport, getTeachersReport, getTeacherReportDetail,
    getRatesReport, getPaymentsReport, getHomeworkReport,
} from "../../controllers/admin/reportPages";
import { catchAsync } from "../../utils/catchAsync";
import { requirePermission } from "../../middlewares/requirePermission";

const router = Router();

// Reports pages (Students / Courses / Teachers / Rates / Payments / Extra H.W) — read-only summaries.
const view = requirePermission("reports", "View");
router.get("/students", view, catchAsync(getStudentsReport));
router.get("/courses", view, catchAsync(getCoursesReport));
router.get("/teachers", view, catchAsync(getTeachersReport));
router.get("/teachers/:teacherId", view, catchAsync(getTeacherReportDetail));
router.get("/rates", view, catchAsync(getRatesReport));
router.get("/payments", view, catchAsync(getPaymentsReport));
router.get("/homework", view, catchAsync(getHomeworkReport));

// Per-student report tabs (used by the student profile)
router.get("/:studentId/quizzes", requirePermission("reports", "View"), catchAsync(getStudentQuizReports));
router.get("/:studentId/exams", requirePermission("reports", "View"), catchAsync(getStudentExamReports));
router.get("/:studentId/diagnostic-exam", requirePermission("reports", "View"), catchAsync(getStudentDiagnosticExamReports));

export default router;
