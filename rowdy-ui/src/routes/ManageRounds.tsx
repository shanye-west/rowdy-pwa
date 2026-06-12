import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import Layout from "../components/Layout";
import StatusBanner from "../components/admin/StatusBanner";
import { useAdminTournaments } from "../hooks/admin/useAdminTournaments";
import { useRounds } from "../hooks/admin/useRounds";
import { adminApi } from "../api/admin";
import { getErrorMessage } from "../api/errors";
import type { CreateRoundRequest } from "../api/adminContracts";
import type { RoundDoc, CourseDoc, RoundFormat } from "../types";

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

/** Convert form state to the callable's updates payload */
function formToUpdates(form: RoundFormState) {
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

export default function ManageRounds() {
  const { tournaments, loading: tournamentsLoading, error: tournamentsError } = useAdminTournaments();
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [tournamentId, setTournamentId] = useState("");
  // "" = nothing selected, "new" = create form, otherwise an existing round id
  const [roundId, setRoundId] = useState("");
  const [newRoundId, setNewRoundId] = useState("");
  const [form, setForm] = useState<RoundFormState>(emptyForm);

  const { rounds, error: roundsError, refresh: refreshRounds } = useRounds(tournamentId);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const cSnap = await getDocs(collection(db, "courses"));
        setCourses(cSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseDoc)));
      } catch (err) {
        console.error("Error loading courses:", err);
        setError(getErrorMessage(err, "Failed to load courses"));
      } finally {
        setLoading(false);
      }
    };
    fetchCourses();
  }, []);

  useEffect(() => {
    setRoundId("");
  }, [tournamentId]);

  const selectRound = (id: string) => {
    setRoundId(id);
    setSuccess(null);
    setError(null);
    if (id === "new") {
      setForm({ ...emptyForm, day: String(rounds.length + 1) });
      setNewRoundId("");
      return;
    }
    const r = rounds.find((x) => x.id === id);
    if (r) setForm(roundToForm(r));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (roundId === "new") {
        const payload: CreateRoundRequest = { tournamentId, ...formToUpdates(form) };
        if (newRoundId.trim()) payload.id = newRoundId.trim();
        const res = await adminApi.createRound(payload);
        setSuccess(`Round created${res.roundId ? ` (${res.roundId})` : ""}.`);
      } else {
        await adminApi.updateRound({ roundId, updates: formToUpdates(form) });
        setSuccess("Round updated.");
      }
      await refreshRounds();
      if (roundId === "new") setRoundId("");
    } catch (err) {
      console.error("Error saving round:", err);
      setError(getErrorMessage(err, "Failed to save round"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || tournamentsLoading) {
    return (
      <Layout title="Manage Rounds" showBack>
        <div className="p-4">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout title="Manage Rounds" showBack>
      <div className="p-4 max-w-2xl mx-auto">
        <div className="card p-6">
          <p className="text-sm text-gray-600 mb-6">
            Create rounds and edit format, course, points, drive tracking, skins, and the
            round lock (locking a round freezes score entry for all its matches).
          </p>

          <StatusBanner error={error ?? tournamentsError ?? roundsError} success={success} />

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Tournament</label>
            <select
              value={tournamentId}
              onChange={(e) => setTournamentId(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg"
            >
              <option value="">Select Tournament</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.year} {t.name} {t.active ? "(active)" : ""}{t.test ? " [test]" : ""}
                </option>
              ))}
            </select>
          </div>

          {tournamentId && (
            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2">Round</label>
              <select
                value={roundId}
                onChange={(e) => selectRound(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg"
              >
                <option value="">Select Round</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    Day {r.day} — {r.format || "Format TBD"}{r.locked ? " 🔒" : ""}
                  </option>
                ))}
                <option value="new">+ Create New Round</option>
              </select>
            </div>
          )}

          {tournamentId && roundId && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {roundId === "new" && (
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

              <div className="flex gap-4">
                <button type="submit" disabled={submitting} className="btn btn-primary flex-1">
                  {submitting ? "Saving..." : roundId === "new" ? "Create Round" : "Save Round"}
                </button>
                <Link to="/admin" className="btn btn-secondary">Cancel</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}
