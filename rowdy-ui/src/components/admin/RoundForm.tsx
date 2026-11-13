import { useState } from "react";
import { Button } from "../ui/button";
import { Field, FieldGroup, ToggleList, ToggleRow } from "./fields";
import { inputClass, monoInputClass } from "./inputStyles";
import type { CourseDoc, RoundDoc, RoundFormat } from "../../types";
import type { RoundUpdates } from "../../api/adminContracts";

// `fourManScramble` is deliberately absent: it exists only to render historical
// tournaments and is not a scorable format for new rounds.
const FORMAT_OPTIONS: { value: RoundFormat | ""; label: string }[] = [
  { value: "", label: "Format TBD" },
  { value: "twoManBestBall", label: "2-Man Best Ball" },
  { value: "twoManShamble", label: "2-Man Shamble" },
  { value: "twoManScramble", label: "2-Man Scramble" },
  { value: "singles", label: "Singles" },
];

interface RoundFormState {
  day: string;
  format: RoundFormat | "";
  courseId: string;
  pointsValue: string;
  trackDrives: boolean;
  locked: boolean;
  skinsGrossPot: string;
  skinsNetPot: string;
  skinsHandicapPercent: string;
}

const emptyForm: RoundFormState = {
  day: "1",
  format: "",
  courseId: "",
  pointsValue: "1",
  trackDrives: false,
  locked: false,
  skinsGrossPot: "0",
  skinsNetPot: "0",
  skinsHandicapPercent: "100",
};

function roundToForm(r: RoundDoc): RoundFormState {
  return {
    day: String(r.day ?? 0),
    format: r.format ?? "",
    courseId: r.courseId ?? "",
    pointsValue: String(r.pointsValue ?? 1),
    trackDrives: !!r.trackDrives,
    locked: !!r.locked,
    skinsGrossPot: String(r.skinsGrossPot ?? 0),
    skinsNetPot: String(r.skinsNetPot ?? 0),
    skinsHandicapPercent: String(r.skinsHandicapPercent ?? 100),
  };
}

function formToUpdates(form: RoundFormState): RoundUpdates {
  return {
    day: Number(form.day),
    format: form.format === "" ? null : form.format,
    courseId: form.courseId === "" ? null : form.courseId,
    pointsValue: Number(form.pointsValue),
    trackDrives: form.trackDrives,
    locked: form.locked,
    skinsGrossPot: Number(form.skinsGrossPot),
    skinsNetPot: Number(form.skinsNetPot),
    skinsHandicapPercent: Number(form.skinsHandicapPercent),
  };
}

interface RoundFormProps {
  /** Prefill for edit mode; omit for create. */
  initial?: RoundDoc;
  /** Default day for create mode (e.g. rounds.length + 1). */
  defaultDay?: number;
  courses: CourseDoc[];
  /** Shown only in create mode. */
  showRoundIdInput?: boolean;
  /**
   * Drops the Locked switch and leaves `locked` out of the saved updates — for
   * a page that has its own live lock control, so saving these settings can't
   * silently undo a lock flipped since the form opened.
   */
  hideLock?: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (updates: RoundUpdates, newRoundId: string) => void;
}

/** Shared round create/edit form body. */
export default function RoundForm({
  initial,
  defaultDay,
  courses,
  showRoundIdInput = false,
  hideLock = false,
  submitting,
  submitLabel,
  onSubmit,
}: RoundFormProps) {
  const [form, setForm] = useState<RoundFormState>(
    initial ? roundToForm(initial) : { ...emptyForm, day: String(defaultDay ?? 1) }
  );
  const [newRoundId, setNewRoundId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updates = formToUpdates(form);
    if (hideLock) delete updates.locked;
    onSubmit(updates, newRoundId.trim());
  };

  const skinsEligible = form.format === "singles" || form.format === "twoManBestBall";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {showRoundIdInput && (
        <Field label="Round ID" optional hint="Auto-generated when blank.">
          <input
            type="text"
            value={newRoundId}
            onChange={(e) => setNewRoundId(e.target.value)}
            placeholder="e.g. rc2026-day1"
            className={monoInputClass}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Day">
          <input
            type="number"
            min="0"
            value={form.day}
            onChange={(e) => setForm({ ...form, day: e.target.value })}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Points per match">
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.pointsValue}
            onChange={(e) => setForm({ ...form, pointsValue: e.target.value })}
            className={inputClass}
            required
          />
        </Field>
        <Field label="Format">
          <select
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value as RoundFormat | "" })}
            className={inputClass}
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            {/* Historical rounds only — kept so an old 4-man scramble round can be
                edited without its format silently round-tripping to null. */}
            {initial?.format === "fourManScramble" && (
              <option value="fourManScramble">4-Man Scramble (historical)</option>
            )}
          </select>
        </Field>
        <Field label="Course">
          <select
            value={form.courseId}
            onChange={(e) => setForm({ ...form, courseId: e.target.value })}
            className={inputClass}
          >
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
                {c.tees ? ` — ${c.tees}` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ToggleList>
        {!hideLock && (
          <ToggleRow
            label="Locked"
            description="Freezes score entry for every match in the round."
            checked={form.locked}
            onChange={(locked) => setForm({ ...form, locked })}
          />
        )}
        <ToggleRow
          label="Track drives"
          description="Scramble and shamble only — records whose drive was used."
          checked={form.trackDrives}
          onChange={(trackDrives) => setForm({ ...form, trackDrives })}
        />
      </ToggleList>

      <FieldGroup
        title="Skins"
        description={
          skinsEligible
            ? "Pots for this round. Leave at 0 to run no skins game."
            : "Singles and best ball only — ignored for the current format."
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Gross pot $">
            <input
              type="number"
              min="0"
              value={form.skinsGrossPot}
              onChange={(e) => setForm({ ...form, skinsGrossPot: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Net pot $">
            <input
              type="number"
              min="0"
              value={form.skinsNetPot}
              onChange={(e) => setForm({ ...form, skinsNetPot: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Handicap %">
            <input
              type="number"
              min="0"
              max="100"
              value={form.skinsHandicapPercent}
              onChange={(e) => setForm({ ...form, skinsHandicapPercent: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>
      </FieldGroup>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
