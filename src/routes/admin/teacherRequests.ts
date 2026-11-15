import { Router } from "express";
import {
    listTeacherRequests, respondToTeacherRequest, getTeacherAvailabilityForAdmin,
} from "../../controllers/admin/teacherRequests";
import { validate } from "../../middlewares/validation";
import { respondTeacherRequestSchema } from "../../validation/teacher/portal";
import { requirePermission } from "../../middlewares/requirePermission";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/", requirePermission("teachers", "View"), catchAsync(listTeacherRequests));
router.get("/availability/:teacherId", requirePermission("teachers", "View"), catchAsync(getTeacherAvailabilityForAdmin));
router.patch("/:id/respond", requirePermission("teachers", "Edit"), validate(respondTeacherRequestSchema), catchAsync(respondToTeacherRequest));

export default router;
