# Admin Store API

Backend for **Store → Courses** in the admin: every price of a course (the course, each chapter, each lesson) in one place,
with bulk tools. Pricing works exactly as before: each course / chapter / lesson has its own plans, checkout charges the
**EGP total** (`price − discount`), USD is stored alongside. Packages keep using the existing `/api/admin/package` API,
currency rates the existing `/api/admin/currency` API.

Controller `src/controllers/admin/store.ts` · Routes `src/routes/admin/store.ts` · Validation `src/validation/admin/store.ts`
· Shared saver `src/utils/pricePlans.ts`. Base path `/api/admin/store`, permission module **courses** (View / Edit).

## Fix shipped with it: price edits no longer delete enrolments
`enrolledItems.priceId` pointed at `prices` with **ON DELETE CASCADE**, and the Edit course / chapter / lesson forms saved
prices by deleting every plan and inserting new ones — so each save deleted the enrolments bought with those plans.
- Migration **0023_enrolled_price_set_null**: the foreign key is now **ON DELETE SET NULL** (a removed plan never removes an enrolment).
- `syncPricePlans()` updates plans **in place** (they keep their ids): match by `id`, else by the same label + days, else a new plan;
  plans no longer listed are removed. Used by the course / chapter / lesson update endpoints and by this API.
- The three Edit forms now send each plan's `id`.

## Plan shape
```
{ id?, label, days (1–3650), priceEgp, priceUsd, hasDiscount, discountEgp?, discountUsd? }
```
Responses add `totalEgp`, `totalUsd` (price − discount, what checkout charges), `isDefault` (the first plan), and
`enrolments` (how many enrolments were bought with this plan). An item needs at least one plan; a discount can't exceed the price.

## Endpoints
- `GET /courses` → `{ courses: [{ id, name, category, chapters, lessons, students, pricedChapters, pricedLessons, plans: [plan], fromEgp }] }`
- `GET /courses/:courseId` → `{ course: { id, name, category, plans }, chapters: [{ id, name, plans, lessons: [{ id, name, plans }] }] }` (course order)
- `PUT /prices/:type/:id` `{ plans }` — `type` = course | chapter | lesson. Saves one item's plans.
- `POST /prices/apply` `{ targets: [{ type, id }], plans }` — gives every target the same plans (ids in `plans` are ignored;
  a target's plan with the same label + days is updated in place so its enrolments stay linked; others are removed and their
  enrolments keep access but lose the link). → `{ updated, plansRemoved }`
- `POST /prices/adjust` `{ targets, percent (−90…500), currency: egp|usd|both, roundTo }` — multiplies prices (and discounts)
  of all plans of the targets. EGP is rounded to `roundTo` (e.g. 5 → nearest 5 EGP); USD keeps exact cents.
  A discount is capped at the new price. → `{ plansUpdated }`
