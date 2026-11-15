import { Router } from "express";
import {
    listMyRequests, createRequest, withdrawRequest,
    getMyAvailability, saveMyAvailability,
    listMyNotifications, markNotificationsRead,
} from "../../controllers/teacher/portal";
import { validate } from "../../middlewares/validation";
import { createTeacherRequestSchema, saveAvailabilitySchema } from "../../validation/teacher/portal";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

// Cover / cancellation requests to admin
router.get("/requests", catchAsync(listMyRequests));
router.post("/requests", validate(createTeacherRequestSchema), catchAsync(createRequest));
router.delete("/requests/:id", catchAsync(withdrawRequest));

// Weekly availability (saving shares it with admin)
router.get("/availability", catchAsync(getMyAvailability));
router.put("/availability", validate(saveAvailabilitySchema), catchAsync(saveMyAvailability));

// Notifications
router.get("/notifications", catchAsync(listMyNotifications));
router.patch("/notifications/read", catchAsync(markNotificationsRead));

export default router;
