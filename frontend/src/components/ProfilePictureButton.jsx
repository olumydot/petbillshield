import { useRef, useState } from "react";
import api, { BACKEND_ORIGIN } from "../lib/api";

const BACKEND = BACKEND_ORIGIN;

export default function ProfilePictureButton({ user, refresh }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const pictureSrc = user?.picture
    ? user.picture.startsWith("http")
        ? user.picture
        : user.picture.startsWith("/uploads")
        ? `${BACKEND}${user.picture}`
        : user.picture.startsWith("uploads")
        ? `${BACKEND}${user.picture}`
        : user.picture
    : "";

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploading(true);

      await api.post("/auth/profile-picture", formData);

      await refresh();
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative group">
      <button
        onClick={() => inputRef.current?.click()}
        className="relative"
      >
        {pictureSrc ? (
          <img
            src={pictureSrc}
            alt={user?.name || "Profile"}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-full object-cover border border-[#E5E2D9]"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#F2F0E9]" />
        )}

        <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-[10px]">
          {uploading ? "..." : "Edit"}
        </div>
      </button>

      <input
        type="file"
        accept="image/*"
        ref={inputRef}
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
}
