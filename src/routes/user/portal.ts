import { Router } from "express";
import { listMyNotifications, markMyNotificationsRead } from "../../controllers/user/portal";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/", catchAsync(listMyNotifications));
router.patch("/read", catchAsync(markMyNotificationsRead));

export default router;
