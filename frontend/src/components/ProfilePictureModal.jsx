import { useState } from "react";
import api from "../lib/api";

export default function ProfilePictureModal({ user, onDone }) {
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!user || user.picture) return null;

  const upload = async () => {
    if (!file) {
      onDone();
      return;
    }

    try {
      setSaving(true);
      setError("");

      const formData = new FormData();
      formData.append("file", file);

      await api.post("/auth/profile-picture", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      onDone(true);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not upload picture");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6">
        <h2 className="text-2xl font-semibold mb-2">
          Add your profile picture
        </h2>

        <p className="text-sm text-gray-500 mb-5">
          This helps personalize your dashboard. You can also skip this for now.
        </p>

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full border rounded-lg p-3"
        />

        {error && (
          <p className="text-red-500 text-sm mt-3">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => onDone()}
            className="px-4 py-2 rounded-lg border"
          >
            Skip
          </button>

          <button
            onClick={upload}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-black text-white"
          >
            {saving ? "Saving..." : "Save picture"}
          </button>
        </div>
      </div>
    </div>
  );
}