// Supabase Edge Function: the planner's in-app AI assistant.
//
// Not turned on yet — the frontend only calls this when built with
// VITE_AI_ENABLED=true (see src/AIAssistant.jsx), so this function existing
// and being deployed does not itself incur any API cost. Turning it on for
// real is: (1) set VITE_AI_ENABLED=true at deploy time, (2) set the
// ANTHROPIC_API_KEY secret below.
//
// Secrets this function needs (set via `supabase secrets set`, never in
// frontend code):
//   ANTHROPIC_API_KEY   - Anthropic API key
//
// Deploy: supabase functions deploy ai-assistant

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.32";

const MODEL = "claude-sonnet-5";

// Every tool mirrors an existing `patch()` mutation in pages.js exactly —
// see the matching push() call cited in each comment. The assistant's
// reach is intentionally limited to what a user could already do by hand;
// nothing here invents new mutation shapes.
const TOOLS = [
  {
    name: "add_task",
    description: "Add a one-off task to the Task Tracker.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        cat: { type: "string", enum: ["Work", "Home", "Health", "Finance", "Family", "Personal", "Errands", "Study", "Fitness", "Social", "Admin", "Other"] },
        prio: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
        due: { type: "string", description: "ISO date, YYYY-MM-DD" },
        est: { type: "string", description: "free-text time estimate, e.g. '30m' or '2h'" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_expense",
    description: "Log a one-off expense.",
    input_schema: {
      type: "object",
      properties: {
        desc: { type: "string" },
        cat: { type: "string", enum: ["Groceries", "Dining", "Transport", "Utilities", "Housing", "Health", "Subscriptions", "Shopping", "Kids", "Pets", "Travel", "Gifts"] },
        amount: { type: "number" },
        date: { type: "string", description: "ISO date, YYYY-MM-DD; defaults to today if omitted" },
      },
      required: ["desc", "amount"],
    },
  },
  {
    name: "add_habit",
    description: "Add a new habit to track on the Habit Tracker.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

const SYSTEM_PROMPT = `You are the in-app assistant for "Align". You can answer
questions about the user's data using the JSON context provided with each
message, and you can take three actions via tools: add_task, add_expense,
add_habit. Only call a tool when the user clearly asked for that action.
For questions ("how much did I spend on X", "what's due this week"), answer
directly from the context JSON instead of calling a tool. Keep replies
short and concrete — this is a compact mobile chat panel, not a long-form
assistant.`;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return new Response("Unauthorized", { status: 401 });

    const { message, context } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'message'" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // The feature is deployed but not switched on yet — fail soft with a
      // clear, expected message rather than a 500.
      return new Response(JSON.stringify({ reply: "The AI assistant isn't turned on yet." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: [
        { role: "user", content: `Context (JSON): ${JSON.stringify(context || {})}\n\nMessage: ${message}` },
      ],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    const text = resp.content.find((b) => b.type === "text")?.text || "";

    return new Response(JSON.stringify({
      reply: text,
      tool: toolUse ? { name: toolUse.name, args: toolUse.input } : null,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
