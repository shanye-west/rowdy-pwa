/**
 * Admin-only callables for managing course documents from the in-app Admin UI
 * (replaces the seed-course.ts script for normal use).
 *
 * All writes go through the Admin SDK, which bypasses security rules — every
 * callable must start with requireAdmin().
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { validateCourseInput } from "../helpers/adminValidation.js";

function db() {
  return getFirestore();
}

/**
 * Create or fully replace a course. Courses are always written whole so the
 * 18-hole invariants (numbers and hcpIndex 1-18 unique, par totals) hold.
 *
 * Note: rounds reference courses by id and matches snapshot strokesReceived at
 * seed time — editing a course does not retroactively change existing matches
 * (use recalculateMatchStrokes per match).
 *
 * Data payload:
 * - courseId?: string - omit to create with an auto id
 * - name, tees?, par, rating, slope, holes[18]
 */
export const upsertCourse = onCall(async (request) => {
  await requireAdmin(request, "upsertCourse", { maxCalls: 20, windowSeconds: 60 });

  const { courseId, ...course } = (request.data ?? {}) as Record<string, unknown>;
  const validation = validateCourseInput(course);
  if (!validation.ok || !validation.course) {
    throw new HttpsError("invalid-argument", validation.errors.join("; "));
  }

  const ref = courseId
    ? db().collection("courses").doc(String(courseId).trim())
    : db().collection("courses").doc();
  if (courseId && !ref.id) {
    throw new HttpsError("invalid-argument", "courseId must be a non-empty string");
  }

  const existing = await ref.get();
  const created = !existing.exists;

  await ref.set({
    ...validation.course,
    [created ? "_adminCreatedAt" : "_adminUpdatedAt"]: FieldValue.serverTimestamp(),
  }, { merge: false });

  return { success: true, courseId: ref.id, created };
});

/**
 * Delete a course. Blocked while any round references it.
 *
 * Data payload:
 * - courseId: string
 */
export const deleteCourse = onCall(async (request) => {
  await requireAdmin(request, "deleteCourse", { maxCalls: 10, windowSeconds: 60 });

  const courseId = typeof request.data?.courseId === "string" ? request.data.courseId.trim() : "";
  if (!courseId) {
    throw new HttpsError("invalid-argument", "courseId is required");
  }

  const ref = db().collection("courses").doc(courseId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Course not found");
  }

  const roundsSnap = await db()
    .collection("rounds")
    .where("courseId", "==", courseId)
    .limit(1)
    .get();
  if (!roundsSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      `Course is used by round "${roundsSnap.docs[0].id}". Point those rounds at another course first.`
    );
  }

  await ref.delete();
  return { success: true, courseId };
});
