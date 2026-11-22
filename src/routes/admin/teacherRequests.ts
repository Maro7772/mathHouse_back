import { Router } from "express";
import {
    listTeacherRequests, respondToTeacherRequest, getTeacherAvailabilityForAdmin, saveTeacherAvailabilityForAdmin,
} from "../../controllers/admin/teacherRequests";
import { validate } from "../../middlewares/validation";
import { respondTeacherRequestSchema, saveAvailabilitySchema } from "../../validation/teacher/portal";
import { requirePermission } from "../../middlewares/requirePermission";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/", requirePermission("teachers", "View"), catchAsync(listTeacherRequests));
router.get("/availability/:teacherId", requirePermission("teachers", "View"), catchAsync(getTeacherAvailabilityForAdmin));
// the admin sets a teacher's weekly working hours
router.put("/availability/:teacherId", requirePermission("teachers", "Edit"), validate(saveAvailabilitySchema), catchAsync(saveTeacherAvailabilityForAdmin));
router.patch("/:id/respond", requirePermission("teachers", "Edit"), validate(respondTeacherRequestSchema), catchAsync(respondToTeacherRequest));

export default router;
