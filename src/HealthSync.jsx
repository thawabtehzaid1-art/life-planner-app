import { useState } from "react";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

// There is no direct connection a website can make to Apple Health — that
// data only exists on-device, behind HealthKit, which no browser API can
// reach. An Apple Shortcut is the actual bridge: it runs natively with
// real Health access and can call a plain URL, which is what this token
// authenticates (an unattended automation can't do a live login the way
// the app itself does).
export default function HealthSync({ token, busy, onGenerate, onDismiss }) {
  const [copied, setCopied] = useState("");

  const urlFor = (type) =>
    `${FUNCTIONS_URL}/health-ingest?token=${token}&type=${type}&date=[Formatted Date]&value=[Health Value]`;

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 2000);
    });
  };

  return (
    <div className="welcome-card health-sync-card">
      <div className="welcome-title">🩺 Health Sync (via Apple Shortcuts)</div>
      <p className="health-sync-note">
        Websites can't read Apple Health directly — no app can, without being installed from the App Store.
        The Shortcuts app is the real bridge: it has native Health access and can call a plain web address,
        which is what the token below is for.
      </p>
      {token ? (
        <>
          <div className="health-sync-row">
            <span className="health-sync-label">Your token</span>
            <code className="health-sync-token">{token}</code>
            <button type="button" className="header-link-btn" onClick={() => copy(token, "token")}>
              {copied === "token" ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="health-sync-row">
            <span className="health-sync-label">Steps URL</span>
            <button type="button" className="header-link-btn" onClick={() => copy(urlFor("steps"), "steps")}>
              {copied === "steps" ? "Copied!" : "Copy Steps URL"}
            </button>
          </div>
          <div className="health-sync-row">
            <span className="health-sync-label">Sleep URL</span>
            <button type="button" className="header-link-btn" onClick={() => copy(urlFor("sleepHours"), "sleep")}>
              {copied === "sleep" ? "Copied!" : "Copy Sleep URL"}
            </button>
          </div>
          <ol className="welcome-list health-sync-steps">
            <li>Open the Shortcuts app → New Shortcut → add "Find Health Samples", set Sample Type to Steps (or Sleep Analysis) and Start Date to Today.</li>
            <li>Add "Calculate Statistics" → Operation: Sum → input: the result of "Find Health Samples" (steps come in many small samples through the day, so this adds them up into one number).</li>
            <li>Add "Format Date" → set its Date field to Current Date → set Date Format to Custom → type <code>yyyy-MM-dd</code> exactly.</li>
            <li>Add "Get Contents of URL" — paste the copied URL, then tap into the text to delete the placeholder words <code>[Health Value]</code> and <code>[Formatted Date]</code> and replace each with the matching chip (Sum / Format Date) from the row above the keyboard — tap the chip, don't type it.</li>
            <li>Run it once — iOS will ask permission to share your Health data with Shortcuts the first time; allow it.</li>
            <li>Once it works, add a Personal Automation (e.g. "Every morning at 8am") so it runs on its own.</li>
          </ol>
          <div className="health-sync-row">
            <button type="button" className="welcome-link" onClick={onGenerate} disabled={busy}>
              {busy ? "Generating…" : "Generate a new token (invalidates the old one)"}
            </button>
            <button type="button" className="welcome-link" onClick={onDismiss}>Hide this</button>
          </div>
        </>
      ) : (
        <div className="health-sync-row">
          <button type="button" className="btn-outline" onClick={onGenerate} disabled={busy}>
            {busy ? "Generating…" : "Set up Health Sync"}
          </button>
          <button type="button" className="welcome-link" onClick={onDismiss}>Not now</button>
        </div>
      )}
    </div>
  );
}
