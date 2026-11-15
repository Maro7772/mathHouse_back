import { Request, Response } from "express";
import { db } from "../../models/connection";
import { popups } from "../../models/schema/admin/Popup";
import { eq, and, gt, lte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors";
import { validateAndSaveLogo, handleImageUpdate, deleteImage } from "../../utils/handleImages";
import { randomUUID } from "crypto";

// ===================== CRUD =====================

/** "true"/"false"/1/0/boolean → boolean; anything else → undefined (not sent). */
const toBool = (v: any): boolean | undefined =>
    v === true || v === "true" || v === 1 || v === "1" ? true
        : v === false || v === "false" || v === 0 || v === "0" ? false
            : undefined;

/** The end date is a calendar day saved as its midnight: the popup keeps showing for that whole day. */
const DAY_MS = 24 * 60 * 60 * 1000;
const endsAt = (endDate: Date | string) => new Date(new Date(endDate).getTime() + DAY_MS);

/** isActive = the admin's on/off switch; status/isLive = what that means today.
    A popup shows until its end date is over or until it is switched off — whichever comes first. */
const withStatus = (p: typeof popups.$inferSelect, now = new Date()) => {
    const started = new Date(p.startDate) <= now;
    const ended = endsAt(p.endDate) <= now;
    const status = !p.isActive ? "inactive" : ended ? "ended" : started ? "live" : "scheduled";
    return { ...p, isActive: !!p.isActive, isLive: status === "live", status };
};

export const createPopup = async (req: Request, res: Response) => {
    const { name, image, destination, startDate, endDate } = req.body;
    const isActive = toBool(req.body.isActive) ?? true;

    if (!name || !image || !destination || !startDate || !endDate) {
        throw new BadRequest("Name, image, destination, start date and end date are required");
    }

    if (new Date(endDate) <= new Date(startDate)) {
        throw new BadRequest("End date must be after start date");
    }

    const imageURL = await validateAndSaveLogo(req, image, "popups");

    await db.insert(popups).values({
        id: randomUUID(),
        name,
        image: imageURL,
        destination,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isActive,
    });

    return SuccessResponse(res, { message: "Popup created successfully" }, 201);
};

export const getAllPopups = async (req: Request, res: Response) => {
    const allPopups = await db.select().from(popups);

    const now = new Date();
    const result = allPopups.map(p => withStatus(p, now));

    return SuccessResponse(res, { popups: result }, 200);
};

export const getPopupById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const popup = await db.select().from(popups).where(eq(popups.id, id));
    if (popup.length === 0) {
        throw new NotFound("Popup not found");
    }

    return SuccessResponse(res, { popup: withStatus(popup[0]) }, 200);
};

export const updatePopup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, image, destination, startDate, endDate } = req.body;
    const isActive = toBool(req.body.isActive);

    const existing = await db.select().from(popups).where(eq(popups.id, id));
    if (existing.length === 0) {
        throw new NotFound("Popup not found");
    }

    if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
        throw new BadRequest("End date must be after start date");
    }

    const imageURL = await handleImageUpdate(req, existing[0].image, image, "popups");

    await db.update(popups).set({
        ...(name && { name }),
        ...(imageURL && { image: imageURL }),
        ...(destination && { destination }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(isActive !== undefined && { isActive }),
    }).where(eq(popups.id, id));

    return SuccessResponse(res, { message: "Popup updated successfully" }, 200);
};

export const deletePopup = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await db.select().from(popups).where(eq(popups.id, id));
    if (existing.length === 0) {
        throw new NotFound("Popup not found");
    }

    if (existing[0].image) {
        await deleteImage(existing[0].image);
    }

    await db.delete(popups).where(eq(popups.id, id));
    return SuccessResponse(res, { message: "Popup deleted successfully" }, 200);
};

// ===================== USER-FACING =====================

// Returns only active popups for a given destination (student/parent/teacher)
export const getActivePopups = async (req: Request, res: Response) => {
    const { destination } = req.query;

    if (!destination) {
        throw new BadRequest("Destination is required (student, parent, teacher)");
    }

    const now = new Date();

    const activePopups = await db
        .select()
        .from(popups)
        .where(
            and(
                eq(popups.destination, destination as "student" | "parent" | "teacher"),
                eq(popups.isActive, true),
                lte(popups.startDate, now),
                gt(popups.endDate, new Date(now.getTime() - DAY_MS)) // still within the whole end day
            )
        );

    return SuccessResponse(res, { popups: activePopups }, 200);
};
