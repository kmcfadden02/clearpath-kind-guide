import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ShieldAlert, FileText, Navigation, Wrench, Upload, X, ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Helping Hand — Scam checker, bill explainer, app guide & appliance fixes" },
      { name: "description", content: "Check messages for scams, understand bills in plain words, get step-by-step help using apps, and fix common appliance problems." },
      { property: "og:title", content: "Helping Hand" },
      { property: "og:description", content: "Simple, friendly help with scams, bills, apps, and home appliances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Mode = "scam" | "simplify" | "navigate" | "fix";

const MODES: Record<Mode, { title: string; blurb: string; icon: typeof ShieldAlert; upload: string; ask?: string; placeholder?: string; accept: string; multiple: boolean }> = {
  scam: { title: "Is this a scam?", blurb: "Add a picture of a text message or email.", icon: ShieldAlert, upload: "Add a screenshot of the message", ask: "Anything else to mention? (optional)", placeholder: "e.g. They say they're from my bank", accept: "image/*", multiple: true },
  simplify: { title: "Explain my bill or form", blurb: "Add pictures of bills, letters, or forms.", icon: FileText, upload: "Add pictures or PDFs of your papers", ask: "Any question about it? (optional)", placeholder: "e.g. How much do I owe and when?", accept: "image/*,application/pdf", multiple: true },
  navigate: { title: "Help me use an app", blurb: "Add a picture of your screen and say what you want to do.", icon: Navigation, upload: "Add a screenshot of your screen", ask: "What do you want to do?", placeholder: "e.g. I want to send a photo to my daughter", accept: "image/*", multiple: false },
  fix: { title: "Fix my appliance", blurb: "A toaster, dishwasher, oven, washer and more. Add a picture and say what's wrong.", icon: Wrench, upload: "Add a picture of the appliance or the problem", ask: "What's wrong? What happened?", placeholder: "e.g. The dishwasher fills with water but won't drain", accept: "image/*", multiple: true },
};

type Picked = { name: string; type: string; data: string; preview: string };
type Turn = { role: "user" | "assistant"; text: string; files: Picked[] };

const readFile = (f: File) =>
  new Promise<Picked>((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      res({ name: f.name, type: f.type, data: url.split(",")[1] ?? "", preview: url });
    };
    r.onerror = rej;
    r.readAsDataURL(f);
  });

function Index() {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="mb-10 text-center">
        <p className="text-lg font-bold uppercase tracking-widest text-accent">Helping Hand</p>
        <h1 className="mt-2 text-4xl font-bold leading-tight sm:text-5xl">
          {mode ? MODES[mode].title : "What would you like help with?"}
        </h1>
      </header>
      {mode ? <Helper mode={mode} onBack={() => setMode(null)} /> : (
        <>
          <div className="grid gap-5">
            {(Object.keys(MODES) as Mode[]).map((m) => {
              const M = MODES[m];
              return (
                <button key={m} onClick={() => setMode(m)}
                  className="flex items-center gap-6 rounded-2xl border-2 bg-card p-6 text-left shadow-sm transition hover:border-primary hover:shadow-md focus-visible:outline-4 focus-visible:outline-ring">
                  <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
                    <M.icon className="h-10 w-10" />
                  </span>
                  <span>
                    <span className="block text-2xl font-bold">{M.title}</span>
                    <span className="mt-1 block text-lg text-muted-foreground">{M.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-10 text-center text-lg text-muted-foreground">
            Tip: to put Helping Hand on your phone's home screen, tap the Share button or the menu in your browser and choose "Add to Home Screen."
          </p>
        </>
      )}
    </main>
  );
}

function Helper({ mode, onBack }: { mode: Mode; onBack: () => void }) {
  const M = MODES[mode];
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [followUp, setFollowUp] = useState("");

  const add = async (list: FileList | null) => {
    if (!list) return;
    const picked = await Promise.all(Array.from(list).map(readFile));
    setFiles((prev) => (M.multiple ? [...prev, ...picked].slice(0, 10) : picked.slice(0, 1)));
  };

  const go = async () => {
    setError(""); setAnswer("");
  const go = async (isFollowUp = false) => {
    setError(""); setAnswer("");
    const text = (isFollowUp ? followUp : question).trim();
    if (!isFollowUp) {
      if (!files.length && !text) return setError("Please add a picture or describe what's going on.");
      if ((mode === "navigate" || mode === "fix") && !text) return setError("Please tell us what's wrong or what you want to do.");
    } else if (!text) {
      return setError("Please type your question.");
    }
    const usedCount = turns.reduce((n, t) => n + t.files.length, 0);
    const attached = files.slice(usedCount);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          question: text,
          files: attached.map(({ name, type, data }) => ({ name, type, data })),
          history: turns.map((t) => ({ role: t.role, text: t.text, files: t.files.map(({ name, type, data }) => ({ name, type, data })) })),
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || "Something went wrong.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let answerText = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answerText += dec.decode(value, { stream: true });
        setAnswer(answerText);
      }
      if (!answerText.trim()) throw new Error("We couldn't read that. Please try a clearer picture.");
      setTurns((prev) => [...prev, { role: "user", text, files: attached }, { role: "assistant", text: answerText }]);
      setFollowUp("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally { setLoading(false); }
  };

  const verdict = answer.match(/Verdict:\s*(.+)/i)?.[1]?.toLowerCase() ?? "";
  const tone = verdict.includes("scam") ? "border-destructive" : verdict.includes("careful") ? "border-warning" : verdict.includes("safe") ? "border-success" : "border-border";

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-lg font-bold text-primary hover:bg-secondary">
        <ArrowLeft className="h-6 w-6" /> Back
      </button>

      <input ref={inputRef} type="file" hidden accept={M.accept} multiple={M.multiple} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <button onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-3 rounded-2xl border-4 border-dashed border-input bg-card p-10 text-xl font-bold hover:border-primary">
        <Upload className="h-12 w-12 text-primary" /> {M.upload}
      </button>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((f, i) => (
            <div key={i} className="relative h-28 w-28 overflow-hidden rounded-xl border-2 bg-muted">
              {f.type.startsWith("image/") ? <img src={f.preview} alt={f.name} className="h-full w-full object-cover" />
                : <div className="grid h-full place-items-center p-2 text-center text-sm"><FileText className="h-8 w-8" />{f.name}</div>}
              <button aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-full bg-foreground p-1 text-background"><X className="h-5 w-5" /></button>
            </div>
          ))}
        </div>
      )}

      {M.ask && (
        <label className="block">
          <span className="mb-2 block text-xl font-bold">{files.length ? M.ask : M.ask.replace(" (optional)", "")}</span>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={M.placeholder} rows={2}
            className="w-full rounded-xl border-2 border-input bg-card p-4 text-lg focus:border-primary focus:outline-none" />
        </label>
      )}

      <button onClick={go} disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-primary px-6 py-5 text-2xl font-bold text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-60">
        {loading ? <><Loader2 className="h-7 w-7 animate-spin" /> Looking…</> : "Help me"}
      </button>

      {error && <p role="alert" className="rounded-xl bg-destructive p-4 text-lg font-bold text-destructive-foreground">{error}</p>}

      {answer && (
        <section aria-live="polite" className={`answer rounded-2xl border-4 ${tone} bg-card p-6 text-lg`}>
          <ReactMarkdown>{answer}</ReactMarkdown>
        </section>
      )}
    </div>
  );
}
