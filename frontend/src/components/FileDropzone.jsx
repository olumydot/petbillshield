import { useRef, useState } from "react";
import { UploadCloud, FileText, Image as ImageIcon, X, Camera } from "lucide-react";

export default function FileDropzone({ value, onChange, accept = ".pdf,image/*", testId = "file-dropzone", allowCamera = true, compact = false }) {
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const [drag, setDrag] = useState(false);

  function handleFiles(files) {
    if (!files || files.length === 0) return;
    onChange(files[0]);
  }

  return (
    <div
      className={`dropzone text-center ${compact ? "p-4 sm:p-5" : "p-8 sm:p-10"} ${drag ? "is-drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      data-testid={testId}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid={`${testId}-input`}
      />
      {allowCamera && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          data-testid={`${testId}-camera`}
        />
      )}
      {!value ? (
        <div className={`inline-flex flex-col items-center group ${compact ? "gap-2" : "gap-3"}`}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`inline-flex flex-col items-center ${compact ? "gap-2" : "gap-3"}`}
            data-testid={`${testId}-trigger`}
          >
            <span className={`${compact ? "w-9 h-9" : "w-12 h-12"} rounded-full bg-[#FAF9F6] border border-[#E5E2D9] inline-flex items-center justify-center text-[#D26D53]`}>
              <UploadCloud size={compact ? 18 : 22} strokeWidth={1.75} />
            </span>
            <span className={`font-serif-display ${compact ? "text-xl" : "text-2xl"}`}>
              {compact ? "Upload document" : "Drop your vet document here"}
            </span>
            <span className={`${compact ? "text-xs" : "text-sm"} text-[#65635C]`}>
              {compact ? "PDF, JPG, PNG, WEBP" : "or click to browse — PDF, JPG, PNG, WEBP (max ~10MB)"}
            </span>
          </button>
          {allowCamera && (
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="md:hidden mt-2 btn-ghost rounded-md px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"
              data-testid={`${testId}-camera-btn`}
            >
              <Camera size={14}/> Take photo
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 text-left">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-md bg-[#FAF9F6] border border-[#E5E2D9] inline-flex items-center justify-center text-[#556045] shrink-0">
              {value.type?.startsWith("image/") ? <ImageIcon size={18}/> : <FileText size={18}/>}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{value.name}</div>
              <div className="text-xs text-[#65635C]">{Math.round((value.size || 0)/1024)} KB</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="btn-ghost rounded-md px-2.5 py-2 text-xs inline-flex items-center gap-1.5"
            data-testid={`${testId}-clear`}
          >
            <X size={14}/> Remove
          </button>
        </div>
      )}
    </div>
  );
}
