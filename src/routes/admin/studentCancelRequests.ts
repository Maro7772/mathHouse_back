import { Router } from "express";
import { listStudentCancelRequests, respondToStudentCancelRequest } from "../../controllers/admin/studentCancelRequests";
import { requirePermission } from "../../middlewares/requirePermission";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/", requirePermission("sessions", "View"), catchAsync(listStudentCancelRequests));
router.patch("/:id/respond", requirePermission("sessions", "Edit"), catchAsync(respondToStudentCancelRequest));

export default router;
