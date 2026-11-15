import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { requirePermission } from "../../middlewares/requirePermission";
import { validate } from "../../middlewares/validation";
import { listStoreCourses, getStoreCourse, savePlans, applyPlans, adjustPrices } from "../../controllers/admin/store";
import { savePlansSchema, applyPlansSchema, adjustPricesSchema } from "../../validation/admin/store";

// Admin → Store → Courses (prices of courses, chapters and lessons). Mounted at /admin/store.
const router = Router();
router.get("/courses", requirePermission("courses", "View"), catchAsync(listStoreCourses));
router.get("/courses/:courseId", requirePermission("courses", "View"), catchAsync(getStoreCourse));
router.put("/prices/:type/:id", requirePermission("courses", "Edit"), validate(savePlansSchema), catchAsync(savePlans));
router.post("/prices/apply", requirePermission("courses", "Edit"), validate(applyPlansSchema), catchAsync(applyPlans));
router.post("/prices/adjust", requirePermission("courses", "Edit"), validate(adjustPricesSchema), catchAsync(adjustPrices));
export default router;
