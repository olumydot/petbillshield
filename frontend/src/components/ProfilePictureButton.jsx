import { useRef, useState } from "react";
import { toast } from "sonner";
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
      toast.error("Upload failed. Please try another image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative group h-10 w-10 shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#3A4142] bg-[#1D2222] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)] ring-2 ring-[#D26D53]/20 transition hover:ring-[#D26D53]/45 disabled:cursor-wait"
        aria-label="Change profile picture"
      >
        {pictureSrc ? (
          <img
            src={pictureSrc}
            alt={user?.name || "Profile"}
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full rounded-full object-cover"
          />
        ) : (
          <span className="text-sm font-semibold text-[#EFE8DA]">
            {(user?.name || user?.email || "U").charAt(0).toUpperCase()}
          </span>
        )}

        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {uploading ? "..." : "Edit"}
        </span>
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
