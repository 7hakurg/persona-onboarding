import { useEffect, useState } from "react";
import { Onboarding } from "./components/Onboarding";

type Gate = { status: "loading" } | { status: "ready"; gmailEnabled: boolean } | { status: "error"; message: string };

async function bootstrap(): Promise<{ gmailEnabled: boolean }> {
  const session = await fetch("/api/session", { method: "POST", credentials: "same-origin" });
  if (session.status === 429) throw new Error("Too many new sessions from your network — try again in a minute.");
  if (!session.ok) throw new Error("Couldn't start a session. Please refresh.");
  const config = (await fetch("/api/config").then((r) => r.json()).catch(() => ({ gmail: false }))) as { gmail?: boolean };
  return { gmailEnabled: config.gmail === true };
}

export function App() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });

  useEffect(() => {
    bootstrap()
      .then((cfg) => setGate({ status: "ready", ...cfg }))
      .catch((err: unknown) => setGate({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." }));
  }, []);

  if (gate.status === "loading") return <Splash text="Waking up your assistant…" />;
  if (gate.status === "error") return <Splash text={gate.message} />;
  return <Onboarding gmailEnabled={gate.gmailEnabled} />;
}

function Splash({ text }: { text: string }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center text-[15px] text-neutral-500" role="status">
      {text}
    </main>
  );
}
