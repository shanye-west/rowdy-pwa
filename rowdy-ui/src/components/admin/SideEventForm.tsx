import { useState } from "react";
import type { CourseDoc, SideEventDoc, SideEventNine, SideEventPayout } from "../../types";
import type { SideEventUpdates } from "../../api/adminContracts";

interface SideEventFormState {
  name: string;
  courseId: string;
  nine: SideEventNine;
  locked: boolean;
  hidden: boolean;
  /** Kept as strings so a half-typed amount doesn't fight the input. */
  payoutAmounts: string[];
}

const emptyForm: SideEventFormState = {
  name: "3-Man Scramble",
  courseId: "",
  nine: "front",
  locked: false,
  hidden: false,
  payoutAmounts: ["150", "100", "50"],
};

function eventToForm(e: SideEventDoc): SideEventFormState {
  // payouts is stored sorted by place, so index === place - 1.
  const amounts: string[] = [];
  for (const p of e.payouts ?? []) amounts[p.place - 1] = String(p.amount);
  return {
    name: e.name ?? "",
    courseId: e.courseId ?? "",
    nine: e.nine === "back" ? "back" : "front",
    locked: !!e.locked,
    hidden: !!e.hidden,
    payoutAmounts: Array.from(amounts, (a) => a ?? "0"),
  };
}

function formToUpdates(form: SideEventFormState): SideEventUpdates {
  const payouts: SideEventPayout[] = form.payoutAmounts.map((amount, idx) => ({
    place: idx + 1,
    amount: Number(amount) || 0,
  }));
  return {
    name: form.name.trim() || "Side Event",
    courseId: form.courseId === "" ? null : form.courseId,
    nine: form.nine,
    locked: form.locked,
    hidden: form.hidden,
    payouts,
  };
}

interface SideEventFormProps {
  /** Prefill for edit mode; omit for create. */
  initial?: SideEventDoc;
  courses: CourseDoc[];
  submitting: boolean;
  submitLabel: string;
  onSubmit: (updates: SideEventUpdates) => void;
}

/**
 * Create/edit form for a side event — the optional, for-fun 9-hole game.
 *
 * The payouts editor is the point of the "how many places pay, and for how
 * much" requirement: places are always 1..N in order, so the admin only sets
 * amounts and adds/removes places. It's fully editable after creation, which is
 * why it lives here rather than in a one-time create wizard.
 */
export default function SideEventForm({
  initial,
  courses,
  submitting,
  submitLabel,
  onSubmit,
}: SideEventFormProps) {
  const [form, setForm] = useState<SideEventFormState>(
    initial ? eventToForm(initial) : emptyForm
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formToUpdates(form));
  };

  const setPayout = (index: number, value: string) => {
    const next = [...form.payoutAmounts];
    next[index] = value;
    setForm({ ...form, payoutAmounts: next });
  };

  const addPlace = () => setForm({ ...form, payoutAmounts: [...form.payoutAmounts, "0"] });
  const removeLastPlace = () =>
    setForm({ ...form, payoutAmounts: form.payoutAmounts.slice(0, -1) });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-1">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="3-Man Scramble"
          maxLength={60}
          className="w-full p-2 border border-gray-300 rounded-lg"
          required
        />
        <p className="mt-1 text-xs text-gray-500">Shown on the page and in the hamburger menu.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <div>
          <label className="block text-sm font-semibold mb-1">Which nine</label>
          <select
            value={form.nine}
            onChange={(e) => setForm({ ...form, nine: e.target.value as SideEventNine })}
            className="w-full p-2 border border-gray-300 rounded-lg"
          >
            <option value="front">Front 9 (holes 1–9)</option>
            <option value="back">Back 9 (holes 10–18)</option>
          </select>
        </div>
      </div>
      <p className="-mt-2 text-xs text-gray-500">
        Without a course the leaderboard still works — it just ranks by raw total with no par.
      </p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.locked}
            onChange={(e) => setForm({ ...form, locked: e.target.checked })}
          />
          <span className="font-semibold">Locked</span>
          <span className="text-gray-500">(freezes score entry for every team)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.hidden}
            onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
          />
          <span className="font-semibold">Hide from menu</span>
          <span className="text-gray-500">(keeps the data, drops the link)</span>
        </label>
      </div>

      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-semibold mb-1">Payouts</div>
        <p className="text-xs text-gray-500 mb-3">
          How many places pay, and how much. Editable at any time. Tied teams pool the places
          they cover and split evenly.
        </p>

        {form.payoutAmounts.length === 0 ? (
          <div className="text-sm text-gray-500 mb-3">No payouts — nobody gets paid.</div>
        ) : (
          <div className="space-y-2 mb-3">
            {form.payoutAmounts.map((amount, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-16 text-sm font-semibold">
                  {idx + 1}
                  {idx === 0 ? "st" : idx === 1 ? "nd" : idx === 2 ? "rd" : "th"}
                </span>
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={amount}
                  onChange={(e) => setPayout(idx, e.target.value)}
                  className="flex-1 p-2 border border-gray-300 rounded-lg"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={addPlace} className="btn btn-secondary text-sm">
            + Add place
          </button>
          {form.payoutAmounts.length > 0 && (
            <button type="button" onClick={removeLastPlace} className="btn btn-secondary text-sm">
              − Remove last
            </button>
          )}
        </div>
      </div>

      <button type="submit" disabled={submitting} className="btn btn-primary w-full">
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
