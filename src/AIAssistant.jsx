import { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { iso } from "./data.js";

// Gated behind a build-time flag so the entry point renders nothing (and
// fires zero network calls) until the app owner explicitly turns it on —
// see supabase/functions/ai-assistant/index.ts for the other half of that
// gate (it fails soft if ANTHROPIC_API_KEY isn't set either).
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === "true";

// A compact, relevant slice of `data` — not the whole blob — kept small on
// purpose since this gets sent as prompt context on every message.
function buildContext(data) {
  const today = iso(Date.now());
  const openTasks = data.tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const thisMonth = today.slice(0, 7);
  const monthExpenses = data.expenses.filter((x) => (x.date || "").slice(0, 7) === thisMonth);
  return {
    today,
    currency: data.settings.currency,
    openTasks: openTasks.slice(0, 15).map((t) => ({ name: t.name, cat: t.cat, prio: t.prio, due: t.due })),
    thisMonthExpensesTotal: monthExpenses.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
    thisMonthExpensesByCategory: monthExpenses.reduce((m, x) => { m[x.cat] = (m[x.cat] || 0) + (parseFloat(x.amount) || 0); return m; }, {}),
    habits: data.habits.map((h) => h.name),
    upcomingBills: data.bills.filter((b) => !b.paid).map((b) => ({ name: b.name, due: b.due, budget: b.budget })),
  };
}

// Mirrors the exact object shapes pages.js already pushes for these three
// tables (Task Tracker, Expenses, Habit Tracker) — the assistant applies
// changes through the same `patch()` choke point everything else uses,
// with the same default fields, not a parallel mutation path.
function applyTool(patch, tool) {
  const { name, args } = tool;
  if (name === "add_task") {
    patch((n) => n.tasks.push({
      name: args.name, desc: "", cat: args.cat || "Personal", prio: args.prio || "Medium",
      status: "Not Started", who: "Me", due: args.due || iso(Date.now()), est: args.est || "",
    }));
  } else if (name === "add_expense") {
    patch((n) => n.expenses.unshift({
      date: args.date || iso(Date.now()), desc: args.desc, cat: args.cat || "Groceries",
      how: "Debit card", amount: parseFloat(args.amount) || 0,
    }));
  } else if (name === "add_habit") {
    patch((n) => n.habits.push({ name: args.name, tint: "work", days: {} }));
  }
}

function describeTool(tool) {
  const { name, args } = tool;
  if (name === "add_task") return `Add task "${args.name}"${args.due ? ` due ${args.due}` : ""}?`;
  if (name === "add_expense") return `Log expense "${args.desc}" for ${args.amount}?`;
  if (name === "add_habit") return `Add habit "${args.name}"?`;
  return "Apply this change?";
}

export default function AIAssistant({ data, patch }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pendingTool, setPendingTool] = useState(null);

  if (!AI_ENABLED) return null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const { data: res, error } = await supabase.functions.invoke("ai-assistant", {
        body: { message: text, context: buildContext(data) },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      setMessages((m) => [...m, { role: "assistant", text: res.reply || "" }]);
      if (res.tool) setPendingTool(res.tool);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: "Sorry, something went wrong: " + (err.message || err) }]);
    } finally {
      setBusy(false);
    }
  }

  function confirmTool() {
    applyTool(patch, pendingTool);
    setMessages((m) => [...m, { role: "assistant", text: "Done." }]);
    setPendingTool(null);
  }

  return (
    <>
      <button
        type="button"
        className="ai-assistant-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="AI assistant"
      >
        {open ? "×" : "✦ Ask"}
      </button>
      {open && (
        <div className="ai-assistant-panel">
          <div className="ai-assistant-header">Assistant</div>
          <div className="ai-assistant-messages">
            {messages.length === 0 && (
              <div className="ai-assistant-hint">Try "add a task to renew my passport" or "how much did I spend on groceries this month?"</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={"ai-assistant-msg ai-assistant-msg-" + m.role}>{m.text}</div>
            ))}
            {pendingTool && (
              <div className="ai-assistant-confirm">
                <div>{describeTool(pendingTool)}</div>
                <div className="ai-assistant-confirm-actions">
                  <button type="button" className="btn-outline" onClick={confirmTool}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setPendingTool(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          <div className="ai-assistant-input-row">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask or tell me to do something…"
              disabled={busy}
            />
            <button type="button" className="btn-outline" onClick={send} disabled={busy}>{busy ? "…" : "Send"}</button>
          </div>
        </div>
      )}
    </>
  );
}
