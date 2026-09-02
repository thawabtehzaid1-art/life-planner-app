export const KEY = "life-planner-web-live-v1";
export const DAY = 86400000;

export const TINTS = {
  work: "oklch(0.734 0.125 289)",
  home: "oklch(0.734 0.125 25)",
  health: "oklch(0.734 0.125 165)",
  money: "oklch(0.734 0.125 95)",
  people: "oklch(0.734 0.125 225)",
  accent: "var(--color-accent)",
  "": "var(--color-neutral-700)",
};

export const CATS = ["Work", "Home", "Health", "Finance", "Family", "Personal", "Errands", "Study", "Fitness", "Social", "Admin", "Other"];
export const CAT_TINT = { Work: "work", Admin: "work", Study: "work", Home: "home", Errands: "home", Health: "health", Fitness: "health", Finance: "money", Family: "people", Social: "people", Personal: "people", Other: "" };
export const PRIOS = ["Low", "Medium", "High", "Very High"];
export const PRIO_TINT = { Low: "people", Medium: "work", High: "home", "Very High": "home" };
export const STATUSES = ["Not Started", "In Progress", "On Hold", "Completed", "Cancelled"];
export const STATUS_TINT = { "Not Started": "", "In Progress": "work", "On Hold": "money", Completed: "health", Cancelled: "home" };
export const RECUR = ["Daily", "Weekly", "Every 2 Weeks", "Every 3 Weeks", "Every 4 Weeks", "Monthly", "Every 2 Months", "Every 3 Months", "Every 6 Months", "Yearly"];
export const RECUR_DAYS = { Daily: 1, Weekly: 7, "Every 2 Weeks": 14, "Every 3 Weeks": 21, "Every 4 Weeks": 28 };
export const RECUR_MONTHS = { Monthly: 1, "Every 2 Months": 2, "Every 3 Months": 3, "Every 6 Months": 6, Yearly: 12 };
export const PEOPLE = ["Me", "Partner", "Kid 1", "Kid 2"];
export const EXP_CATS = ["Groceries", "Dining", "Transport", "Utilities", "Housing", "Health", "Subscriptions", "Shopping", "Kids", "Pets", "Travel", "Gifts"];
export const EXP_TINT = { Groceries: "health", Dining: "home", Transport: "people", Utilities: "money", Housing: "money", Health: "health", Subscriptions: "money", Shopping: "work", Kids: "people", Pets: "", Travel: "people", Gifts: "home" };
export const AISLES = ["Produce", "Dairy", "Meat & Fish", "Bakery", "Pantry", "Frozen", "Drinks", "Household", "Other"];
export const AISLE_TINT = { Produce: "health", Dairy: "people", "Meat & Fish": "home", Bakery: "money", Pantry: "money", Frozen: "work", Drinks: "people", Household: "money", Other: "" };
export const FOCUS = ["Push", "Pull", "Legs", "Upper Body", "Lower Body", "Full Body", "Core", "Cardio", "Mobility", "Rest"];
export const FOCUS_TINT = { Push: "work", Pull: "work", Legs: "work", "Upper Body": "work", "Lower Body": "work", "Full Body": "work", Core: "work", Cardio: "health", Mobility: "people", Rest: "" };
export const INCOME_TYPES = ["Paycheck", "Side Income", "Bonus", "Refund", "Gift", "Other"];
export const INVEST_TYPES = ["Stocks", "Crypto", "Retirement", "Real Estate", "Bonds", "Other"];
export const DIETS = ["No restrictions", "Vegetarian", "Vegan", "Pescatarian", "Keto", "Paleo", "Mediterranean", "Halal", "Kosher", "Gluten-free", "Other"];
// Regular hourly slots, 7am-9pm — was irregular (10:00 -> 12:00 -> 13:00 ->
// 15:00 -> ...), skipping some hours and not others with no visible reason,
// which read as a bug rather than a deliberate coarser-later-in-the-day
// design (a real one would have stayed evenly spaced after 10:00).
export const HOURS = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
export const DAYNAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n) { return String(n).padStart(2, "0"); }
export function iso(t) { const d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
export function parseISO(s) { if (!s) return null; const p = String(s).split("-"); if (p.length < 3) return null; const t = new Date(+p[0], +p[1] - 1, +p[2]); t.setHours(0, 0, 0, 0); return t.getTime(); }
export function edate(t, months) { const d = new Date(t); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + months); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function fmtDate(t) { if (!t) return "—"; const d = new Date(t); return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getFullYear(); }
export function fmtMon(t) { if (!t) return "—"; const d = new Date(t); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getFullYear(); }
export function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

export function seed() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const t = now.getTime();
  const d = (off) => iso(t + off * DAY);
  return {
    settings: {
      weekStart: "Monday", currency: "$", units: "Metric", month: now.getFullYear() + "-" + pad(now.getMonth() + 1),
      name: "Me", height: 180, gender: "", birthday: "",
      // Read from the device, not typed in — this is what lets reminder
      // times fire at your actual local hour instead of the server's UTC
      // clock. Falls back to UTC only if the browser genuinely can't say.
      timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })(),
      mealsPerDay: 3, diet: "No restrictions",
      fasts: "No", fastStart: "20:00", fastEnd: "12:00",
    },
    onboarded: false,
    // Manual overrides for the setup guide's checklist — most steps detect
    // themselves from real data (see onboardingSteps() in pages.js), this
    // only backs the ones where a default value is itself a valid answer
    // (e.g. your name really is "Me") and can't be auto-detected.
    onboarding: { steps: {} },
    cycle: { periods: [], avgLength: 28, avgDuration: 5 },
    goals: [
      { name: "Emergency fund topped up", cat: "Finance", date: d(190), target: 5000, current: 1250 },
    ],
    tasks: [
      { name: "Renew passport", desc: "Book appointment at the office", cat: "Admin", prio: "High", status: "In Progress", who: "Me", due: d(3), est: "1h" },
    ],
    recurring: [
      { name: "Water the plants", cat: "Home", prio: "Low", who: "Me", first: d(-21), freq: "Weekly" },
    ],
    done: {},
    blocks: {},
    income: [
      { date: d(-21), source: "Monthly salary", type: "Paycheck", amount: 2450, note: "after tax" },
    ],
    bills: [
      { name: "Rent", cat: "Housing", freq: "Monthly", due: d(-21), budget: 1150, actual: 1150, paid: true },
    ],
    budgets: [
      { cat: "Groceries", planned: 320 },
    ],
    expenses: [
      { date: d(-2), desc: "Weekly shop", cat: "Groceries", how: "Debit card", amount: 68 },
    ],
    strategy: "Snowball",
    extra: 200,
    debts: [
      { name: "Overdraft", start: 1260, balance: 480, apr: 39.9, min: 40, order: 1, deadline: "" },
    ],
    savings: [
      { name: "Emergency fund", target: 5000, saved: 1860, date: d(490), monthly: 60 },
    ],
    investments: [
      { name: "Index fund", type: "Stocks", invested: 2000, current: 2240, date: d(-200) },
    ],
    meals: {
      "0-0": "Oats", "1-0": "Oats", "2-0": "Eggs", "3-0": "Oats", "4-0": "Eggs", "5-0": "Big brunch", "6-0": "Big brunch",
      "0-1": "Leftovers", "1-1": "Chickpea wrap", "2-1": "Leftovers", "3-1": "Chickpea wrap", "4-1": "Soup", "5-1": "Out", "6-1": "Leftovers",
      "0-2": "Chicken traybake", "1-2": "Salmon", "2-2": "Pasta", "3-2": "Chilli", "4-2": "Takeaway", "5-2": "Chicken traybake", "6-2": "Roast",
      "0-3": "Fruit", "1-3": "Yoghurt", "2-3": "Fruit", "3-3": "Nuts", "4-3": "Fruit", "5-3": "", "6-3": "Fruit",
    },
    ingredients: [
      { name: "Chicken thighs", aisle: "Meat & Fish", qty: 1000, unit: "g", used: "Mon + Sat dinner" },
    ],
    extras: [
      { name: "Bin bags", aisle: "Household", qty: 1, unit: "pack", got: false },
    ],
    got: {},
    split: { "0-0": "Push", "1-0": "Rest", "2-0": "Pull", "3-0": "Cardio", "4-0": "Legs", "5-0": "Rest", "6-0": "Mobility", "0-1": "Cardio", "1-1": "Full Body", "2-1": "Rest", "3-1": "Cardio", "4-1": "Rest", "5-1": "Full Body", "6-1": "Rest" },
    workouts: [
      { date: d(-1), who: "Me", ex: "Bench press", focus: "Push", sets: 4, reps: 8, weight: 60 },
    ],
    weights: [
      { date: d(-1), who: "Me", kg: 78.4, note: "morning, before food" },
    ],
    weightGoal: { target: 0, motivation: "" },
    habits: [
      { name: "Take meds", tint: "health", days: {}, reminderTime: "" },
    ],
    focusSessions: {}, // ISO date -> count of completed 30-min focus sessions
    journal: {}, // ISO date -> free-text journal entry
  };
}

export function seedHabits(data) {
  const dom = new Date().getDate();
  // First pattern used to be "every day" — with the sample data trimmed to
  // one habit earlier this session, that meant a brand-new account's whole
  // month showed as done with no visible gaps, which (combined with a
  // since-fixed CSS bug hiding the checked color entirely) made the grid
  // look like a static readout instead of something you tick daily.
  const patterns = [
    (i) => i % 4 !== 0, (i) => i % 3 !== 2, (i) => i % 2 === 0,
    (i) => i % 4 === 0, (i) => i % 5 !== 4, (i) => i % 3 === 0,
  ];
  data.habits.forEach((h, n) => {
    // Today itself is always left untouched, whatever the pattern says —
    // a fresh account should always have at least one real, obvious
    // action waiting today, not a grid that already looks finished.
    for (let i = 1; i < dom; i++) if (patterns[n % patterns.length](i)) h.days[i] = true;
  });
  return data;
}
