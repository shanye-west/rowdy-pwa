import { useState } from "react";
import type { CourseDoc, RoundDoc, RoundFormat } from "../../types";
import type { RoundUpdates } from "../../api/adminContracts";

const FORMAT_OPTIONS: { value: RoundFormat | ""; label: string }[] = [
  { value: "", label: "Format TBD" },
  { value: "twoManBestBall", label: "2-Man Best Ball" },
  { value: "twoManShamble", label: "2-Man Shamble" },
  { value: "twoManScramble", label: "2-Man Scramble" },
  { value: "fourManScramble", label: "4-Man Scramble" },
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
  submitting: boolean;
  submitLabel: string;
  onSubmit: (updates: RoundUpdates, newRoundId: string) => void;
}

/** Shared round create/edit form body (formerly inside ManageRounds). */
export default function RoundForm({
  initial,
  defaultDay,
  courses,
  showRoundIdInput = false,
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
    onSubmit(formToUpdates(form), newRoundId.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {showRoundIdInput && (
        <div>
          <label className="block text-sm font-semibold mb-1">
            Round ID <span className="font-normal text-gray-500">(optional, auto-generated if blank)</span>
          </label>
          <input
            type="text"
            value={newRoundId}
            onChange={(e) => setNewRoundId(e.target.value)}
            placeholder="e.g. rc2026-day1"
            className="w-full p-2 border border-gray-300 rounded-lg"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold mb-1">Day</label>
          <input
            type="number"
            min="0"
            value={form.day}
            onChange={(e) => setForm({ ...form, day: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-lg"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Points per match</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.pointsValue}
            onChange={(e) => setForm({ ...form, pointsValue: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-lg"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Format</label>
          <select
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value as RoundFormat | "" })}
            className="w-full p-2 border border-gray-300 rounded-lg"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Course</label>
          <select
            value={form.courseId}
            onChange={(e) => setForm({ ...form, courseId: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-lg"
          >
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.locked}
            onChange={(e) => setForm({ ...form, locked: e.target.checked })}
          />
          <span className="font-semibold">Locked</span>
          <span className="text-gray-500">(freezes score entry for the whole round)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.trackDrives}
            onChange={(e) => setForm({ ...form, trackDrives: e.target.checked })}
          />
          <span className="font-semibold">Track drives</span>
          <span className="text-gray-500">(scramble/shamble only)</span>
        </label>
      </div>

      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-semibold mb-2">Skins (singles / best ball only)</div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1">Gross pot $</label>
            <input
              type="number"
              min="0"
              value={form.skinsGrossPot}
              onChange={(e) => setForm({ ...form, skinsGrossPot: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Net pot $</label>
            <input
              type="number"
              min="0"
              value={form.skinsNetPot}
              onChange={(e) => setForm({ ...form, skinsNetPot: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Handicap %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={form.skinsHandicapPercent}
              onChange={(e) => setForm({ ...form, skinsHandicapPercent: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      <button type="submit" disabled={submitting} className="btn btn-primary w-full">
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
