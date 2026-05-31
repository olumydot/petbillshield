import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import api from "../lib/api";

export default function PetAskBox({ petId }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState("");

  async function ask() {
    if (!petId) {
      setError("Pick a pet first.");
      return;
    }

    if (!question.trim()) {
      setError("Type a question first.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { data } = await api.post("/pets/ask", {
        pet_id: petId,
        question: question.trim(),
      });

      setAnswers((prev) => [data, ...prev]);
      setQuestion("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not answer this question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cream-card p-5">
      <div className="eyebrow mb-3">Ask about this pet</div>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        placeholder="Example: Based on Mochi’s history, what should I ask the vet next?"
        className="w-full rounded-md border border-[#E5E2D9] bg-[#FAF9F6] p-3 text-sm"
      />

      {error && (
        <div className="text-sm text-[#8C2D14] mt-2">{error}</div>
      )}

      <button
        onClick={ask}
        disabled={busy}
        className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 mt-3 disabled:opacity-70"
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Thinking…
          </>
        ) : (
          <>
            <Send size={14} />
            Ask
          </>
        )}
      </button>

      {answers.length > 0 && (
        <div className="mt-5 space-y-3">
          {answers.map((a) => (
            <div key={a.question_id} className="rounded-md border border-[#E5E2D9] bg-[#FAF9F6] p-4">
              <div className="text-sm font-semibold">{a.question}</div>
              <p className="text-sm text-[#65635C] mt-2 whitespace-pre-wrap">
                {a.answer}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}