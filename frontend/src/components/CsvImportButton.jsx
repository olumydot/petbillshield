import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, Loader2, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";

const SAMPLE_CSV = `title,date,amount_usd,category,details
Annual wellness exam,2025-10-12,85.00,exam,Dr. Singh — Riverwood Animal Hospital
Rabies vaccine,2025-10-12,38.00,vaccine,Booster
Dental cleaning + extractions,2025-11-04,640.00,dental,Two molars extracted
Apoquel refill (30ct),2025-11-22,72.50,medication,For chronic skin allergy
CBC + chemistry panel,2025-12-01,210.00,labwork,Annual senior workup`;

export default function CsvImportButton({ petId, onImported }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "petbill_shield_invoices_template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!file) { toast.error("Pick a CSV file first."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/pets/${petId}/records/import-csv`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      if (data?.imported > 0) toast.success(`Imported ${data.imported} record${data.imported === 1 ? "" : "s"}`);
      onImported?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't import CSV.");
    } finally { setBusy(false); }
  }

  function close() {
    setOpen(false); setFile(null); setResult(null);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost rounded-md px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5" data-testid="csv-import-open">
        <Upload size={13}/> Import CSV
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={close} data-testid="csv-import-modal">
          <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF9F6] rounded-lg p-6 w-full max-w-lg border border-[#E5E2D9]">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow text-[#D26D53] mb-1">Bulk import</div>
                <h3 className="font-serif-display text-2xl">Import invoice history</h3>
              </div>
              <button onClick={close} className="text-[#65635C] hover:text-[#2D2C28]" data-testid="csv-import-close"><X size={18}/></button>
            </div>
            <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
              Drop a CSV of past invoices — we'll add them to this pet's vault so the spend trends chart fills in immediately.
            </p>

            {result ? (
              <div className="mt-5 space-y-3" data-testid="csv-import-result">
                <div className="cream-card p-4 flex items-center gap-3">
                  <CheckCircle2 className="text-[#556045]" size={20}/>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Imported {result.imported} record{result.imported === 1 ? "" : "s"}</div>
                    {result.skipped > 0 && <div className="text-xs text-[#65635C]">Skipped {result.skipped} row{result.skipped === 1 ? "" : "s"}</div>}
                  </div>
                </div>
                {(result.errors || []).length > 0 && (
                  <div className="cream-card p-4">
                    <div className="eyebrow text-[#8C2D14] mb-2 inline-flex items-center gap-1.5"><AlertTriangle size={13}/>Issues</div>
                    <ul className="text-xs space-y-1 max-h-28 overflow-auto">
                      {result.errors.map((er, i) => (
                        <li key={i}>Row {er.row}: <span className="text-[#65635C]">{er.reason}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button onClick={close} className="btn-primary rounded-md px-4 py-2 text-sm font-semibold" data-testid="csv-import-done">Done</button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-5">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="dropzone p-6 text-center w-full inline-flex flex-col items-center gap-2"
                    data-testid="csv-import-pick"
                  >
                    <FileSpreadsheet size={26} className="text-[#D26D53]"/>
                    <span className="font-serif-display text-xl">
                      {file ? file.name : "Choose a CSV file"}
                    </span>
                    <span className="text-xs text-[#65635C]">{file ? `${Math.round((file.size || 0) / 1024)} KB` : "Headers: title, date, amount_usd, category, details"}</span>
                  </button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    data-testid="csv-import-input"
                  />
                </div>

                <div className="mt-3 text-xs text-[#65635C] leading-relaxed">
                  Recognized columns (case-insensitive): <code className="kbd">title</code>, <code className="kbd">date</code>, <code className="kbd">amount_usd</code> (or <code className="kbd">amount</code>), <code className="kbd">category</code> (diagnostic, treatment, medication, hospitalization, surgery, imaging, labwork, exam, vaccine, dental, boarding, other), <code className="kbd">details</code>.
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <button onClick={downloadSample} className="editorial-link text-xs inline-flex items-center gap-1.5" data-testid="csv-import-sample">
                    <Download size={13}/> Download sample CSV
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={close} className="btn-ghost rounded-md px-4 py-2 text-sm" data-testid="csv-import-cancel">Cancel</button>
                    <button onClick={submit} disabled={!file || busy} className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70" data-testid="csv-import-submit">
                      {busy ? <><Loader2 size={14} className="animate-spin"/>Importing…</> : <><Upload size={14}/>Import</>}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
