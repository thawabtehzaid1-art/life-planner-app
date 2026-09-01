import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

// google-oauth-start is reached via a real browser navigation (not
// fetch()), so it can't carry an Authorization header — the origin here
// includes BASE_URL, not just location.origin, so the callback redirects
// back into the right place on the GitHub Pages mirror's subpath too.
function returnOrigin() {
  return window.location.origin + import.meta.env.BASE_URL;
}

export function useGoogleCalendar(userId) {
  const [connected, setConnected] = useState(null); // null = not checked yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(`${FUNCTIONS_URL}/calendar-status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setConnected(!!data.connected);
    } catch {
      /* leave connected as whatever it last was — a blip here isn't worth surfacing */
    }
  }, []);

  useEffect(() => { if (userId) refreshStatus(); }, [userId, refreshStatus]);

  // Picks up ?calendar=connected|error left by google-oauth-callback's
  // redirect, then scrubs it from the URL so a page refresh doesn't
  // re-trigger the same message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("calendar")) return;
    const result = params.get("calendar");
    if (result === "connected") setConnected(true);
    else if (result === "error") setError(params.get("msg") || "Something went wrong connecting Google Calendar");
    params.delete("calendar");
    params.delete("msg");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? "?" + rest : ""));
  }, []);

  const connect = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    window.location.href = `${FUNCTIONS_URL}/google-oauth-start?token=${encodeURIComponent(session.access_token)}&origin=${encodeURIComponent(returnOrigin())}`;
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${FUNCTIONS_URL}/calendar-disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error("Couldn't disconnect — try again");
      setConnected(false);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Best-effort, fire-and-forget: called from the same debounce that
  // already saves planner_data, so it runs at most once per save rather
  // than once per keystroke. A failed attempt just gets caught up by the
  // next successful save instead of being retried on its own.
  const sync = useCallback(async (tasks, bills, timezone) => {
    if (!connected) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${FUNCTIONS_URL}/calendar-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tasks, bills, timezone }),
      });
    } catch {
      /* best effort */
    }
  }, [connected]);

  return { connected, busy, error, connect, disconnect, sync };
}
