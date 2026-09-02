import {
  DAY, CATS, CAT_TINT, PRIOS, PRIO_TINT, STATUSES, STATUS_TINT, RECUR, RECUR_MONTHS, RECUR_DAYS,
  PEOPLE, EXP_CATS, EXP_TINT, AISLES, AISLE_TINT, FOCUS, FOCUS_TINT, INCOME_TYPES, INVEST_TYPES, DIETS, HOURS, DAYNAMES,
  iso, parseISO, edate, fmtDate, fmtMon, num,
} from "./data.js";
import {
  plain, chip, edit, numc, datec, timec, sel, tog, barc, datelink, table, notes, phasesBlock, badges, columns, line, donut,
  settingsBlock, calendarBlock, weekBlock, habitGridBlock,
  todayTs, wkStart, monthAnchorAt, monthRange, inRange, weekBounds,
  occurrences, nextDue, lateOccurrences, simulateDebt, groceryRoll, habitStats, cycleStats, cyclePhases, gamificationStats, money,
} from "./engine.js";

// One per day, not per render — Math.random() here would flicker on every
// edit (this function re-runs on every patch). Deterministic on the date
// instead, so it's stable all day and only changes overnight.
const GREETING_QUOTES = [
  "Small steps, every day.",
  "Progress, not perfection.",
  "One thing at a time.",
  "You've got this.",
  "A little bit still counts.",
  "Today's a fresh page.",
];
function greetingFor(name, todayTsValue, birthday) {
  const h = new Date().getHours();
  const label = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dayOfYear = Math.floor(todayTsValue / DAY);
  const quote = GREETING_QUOTES[dayOfYear % GREETING_QUOTES.length];
  // Compared as "MM-DD" (not full dates) on purpose — a birthday recurs
  // every year, so only the month and day should ever match, never the
  // birth year itself. Built from local date parts, not toISOString()
  // (which is UTC and can land on the wrong calendar day depending on the
  // timezone offset) — todayTsValue is already local midnight.
  const todayD = new Date(todayTsValue);
  const todayMD = String(todayD.getMonth() + 1).padStart(2, "0") + "-" + String(todayD.getDate()).padStart(2, "0");
  if (birthday && birthday.slice(5) === todayMD) {
    return { title: "🎉 Happy birthday" + (name ? ", " + name : "") + "!", quote: "Hope today's a good one." };
  }
  return { title: name ? label + ", " + name : label, quote };
}

// Builds every page's view-model from the raw data. `patch(fn)` mutates a
// deep clone of `data` and persists it; `catchUp`/setState-style callbacks
// are threaded straight from App.jsx so this file stays a pure function of
// (data, state) => pages, same shape the design canvas used.
export function buildPages(data, state, { patch, catchUp, setWeek, goToDay, triggerHighlight }) {
  const d = data;
  const today = todayTs();
  const P = {};
  const setS = (k, cast) => (e) => patch((n) => { n.settings[k] = cast ? cast(e.target.value) : e.target.value; });
  // Not trimmed here: this fires on every keystroke now (live-save), and
  // trimming a live value could rewrite the DOM text out from under the
  // caret mid-edit. EditableSpan's trimOnBlur() does the one-time
  // whitespace cleanup when the field actually loses focus instead.
  const txt = (e) => e.target.textContent;
  const mon = (n) => money(d, n);
  // The month Monthly Calendar and Habit Tracker are both browsing —
  // hoisted here (rather than computed locally in each section) because
  // habitStats() below needs it before Monthly Calendar's own section runs.
  const anchor = monthAnchorAt(state.month || 0);

  // ===== Overview
  P.overview = {
    title: "Overview", role: "Edit the setup cells", roleTint: "money",
    sub: "Set these once. Every other tab reads from them.",
    blocks: [
      settingsBlock("Setup", "the only settings in the whole planner", [
        { label: "Your name", isText: true, v: d.settings.name, set: setS("name"), group: "About you" },
        {
          label: "Birthday", isDate: true, v: d.settings.birthday || "",
          hint: "optional — just for a nice surprise on the day",
          set: setS("birthday"), group: "About you",
        },
        { label: "Height (cm)", isNum: true, v: String(d.settings.height), set: setS("height", num), group: "About you" },
        {
          label: "Gender", isSelect: true, v: d.settings.gender || "Prefer not to say",
          hint: "Selecting Female adds a Cycle Tracker tab",
          options: ["Prefer not to say", "Male", "Female", "Other"],
          set: (e) => patch((n) => { n.settings.gender = e.target.value === "Prefer not to say" ? "" : e.target.value; }),
          group: "About you",
        },
        { label: "Week starts on", isSelect: true, v: d.settings.weekStart, options: ["Monday", "Sunday"], set: setS("weekStart"), group: "Preferences" },
        { label: "Currency symbol", isText: true, v: d.settings.currency, set: setS("currency"), maxLength: 3, group: "Preferences" },
        { label: "Measurement units", isSelect: true, v: d.settings.units, options: ["Metric", "Imperial"], set: setS("units"), group: "Preferences" },
        {
          label: "Timezone", isText: true, v: d.settings.timezone || "UTC",
          hint: "Detected from this device automatically — only change it if that's wrong",
          set: setS("timezone"), group: "Preferences",
        },
      ]),
      table({
        title: "Your goals", note: "target dates land on the calendar; progress feeds the dashboard",
        emptyLabel: "No goals yet", emptyNote: "Add one below to start tracking progress toward it.",
        grid: "1.9fr 120px 150px 110px 110px 1fr 110px",
        head: ["Goal", "Category", "Target date", { t: "Target", align: "right" }, { t: "Current", align: "right" }, "Progress", "Status"],
        rows: d.goals.map((g, i) => {
          const pct = num(g.target) ? Math.min(100, 100 * num(g.current) / num(g.target)) : 0;
          const due = parseISO(g.date);
          const status = pct >= 100 ? "Done" : (!due ? "No date" : (due < today ? "Overdue" : "On track"));
          return {
            remove: () => patch((n) => n.goals.splice(i, 1)),
            cells: [
              edit(g.name, (e) => patch((n) => { n.goals[i].name = txt(e); })),
              sel(g.cat, (e) => patch((n) => { n.goals[i].cat = e.target.value; }), CATS, CAT_TINT[g.cat]),
              datec(g.date, (e) => patch((n) => { n.goals[i].date = e.target.value; })),
              numc(g.target, (e) => patch((n) => { n.goals[i].target = num(e.target.value); })),
              numc(g.current, (e) => patch((n) => { n.goals[i].current = num(e.target.value); })),
              barc(pct, Math.round(pct) + "%", pct >= 100 ? "health" : CAT_TINT[g.cat]),
              chip(status, status === "Overdue" ? "home" : (status === "Done" ? "health" : (status === "No date" ? "" : "health"))),
            ],
          };
        }),
        add: () => patch((n) => n.goals.push({ name: "New goal", cat: "Personal", date: iso(today + 90 * DAY), target: 100, current: 0 })),
        addLabel: "+ New goal",
      }),
    ],
  };

  // ===== Cycle (only reachable when Overview's Gender setting is "Female" — see NAV_GROUPS)
  // `d.cycle` may not exist yet on accounts saved before this feature shipped,
  // so every read below falls back rather than assuming it's there; every
  // `patch` callback initializes it on the cloned draft before mutating.
  if (d.settings.gender === "Female") {
    const cycleData = d.cycle || { periods: [], avgLength: 28, avgDuration: 5 };
    const cyc = cycleStats({ cycle: cycleData }, today);
    const withCycle = (fn) => patch((n) => { if (!n.cycle) n.cycle = { periods: [], avgLength: 28, avgDuration: 5 }; fn(n); });
    // Copy for each phase cyclePhases() can return — kept separate from the
    // day-range math so the two can be reasoned about (and edited) on their
    // own. "May help" notes are phrased as suggestions, never instructions,
    // matching this screen's existing "estimate, not a medical prediction"
    // framing.
    const PHASE_COPY = {
      menstrual: {
        whatHappens: "The uterine lining sheds — this is the bleeding itself. Estrogen and progesterone are at their lowest, which is often why energy dips too.",
        selfCare: "rest when you need it, warmth for cramps, iron-rich food, and light movement like walking — often eases cramping more than staying still.",
      },
      follicular: {
        whatHappens: "Estrogen climbs as the body prepares to release an egg. Energy and mood commonly lift through this stretch.",
        selfCare: "a good window for more demanding workouts or focus-heavy tasks, if that matches how you're feeling.",
      },
      ovulatory: {
        whatHappens: "An egg is released as estrogen peaks. Some people notice a short burst of energy around this time.",
        selfCare: "nothing specific — worth noting if you're tracking symptoms alongside the calendar.",
      },
      luteal: {
        whatHappens: "Progesterone rises then falls — the drop late in this phase is usually behind PMS symptoms like mood changes, bloating, or fatigue.",
        selfCare: "prioritizing sleep, gentle movement, and going easy on yourself tends to help more than pushing through — cravings here are normal, not a lack of willpower.",
      },
    };
    const phases = cyclePhases(cyc.cycleDay, cyc.avgLength, cyc.duration).map((p) => ({ ...p, ...PHASE_COPY[p.id] }));
    const currentPhase = phases.find((p) => p.current);
    P.cycle = {
      title: "Cycle Tracker", role: "Log period start dates", roleTint: "home",
      sub: "An estimate, not a medical prediction — averages are calculated from the dates you log below.",
      kpis: [
        // No tint on purpose, even while on a period — a reused "home" (the
        // same red as an overdue bill or task) would color-code a normal
        // biological state as a problem. The note text already says "on
        // period" in words, same principle Weight & BMI already applies to
        // its own "Change" stat.
        { label: "Cycle day", value: cyc.cycleDay ? String(cyc.cycleDay) : "—", note: cyc.onPeriod ? "on period" : "", explain: "Days since your most recently logged period start." },
        { label: "Next period", value: cyc.nextStartISO ? fmtDate(cyc.nextStart) : "—", note: cyc.daysUntilNext !== null ? (cyc.daysUntilNext >= 0 ? "in " + cyc.daysUntilNext + " days" : Math.abs(cyc.daysUntilNext) + " days late") : "log a start date", explain: "Projected from your average cycle length and last logged start date." },
        { label: "Avg cycle length", value: cyc.avgLength + " days", note: "", explain: "Averaged from the gaps between your logged period starts, or your typical-cycle setting below until there are at least two." },
        { label: "Avg period length", value: cyc.duration + " days", note: "", explain: "Your typical period length setting below." },
        {
          label: "Phase", value: currentPhase ? currentPhase.label : "—", note: currentPhase ? "Days " + currentPhase.from + "–" + currentPhase.to : "log a start date",
          explain: currentPhase ? currentPhase.whatHappens : "Shows once you've logged a period start — see Your cycle stages below.",
        },
      ],
      blocks: [
        settingsBlock("Typical cycle", "used until at least two periods are logged below", [
          { label: "Typical cycle length (days)", isNum: true, v: String(cycleData.avgLength), set: (e) => withCycle((n) => { n.cycle.avgLength = num(e.target.value); }) },
          { label: "Typical period length (days)", isNum: true, v: String(cycleData.avgDuration), set: (e) => withCycle((n) => { n.cycle.avgDuration = num(e.target.value); }) },
        ]),
        phasesBlock("Your cycle stages", "general patterns, not a diagnosis — every body is different", phases),
        table({
          title: "Period history", note: "one row per period start date",
          emptyLabel: "No periods logged yet", emptyNote: "Log a start date below to get your first estimate.",
          grid: "1fr 1fr",
          head: ["Start date", ""],
          rows: cycleData.periods.slice().sort((a, b) => (parseISO(b) || 0) - (parseISO(a) || 0)).map((p) => {
            const i = cycleData.periods.indexOf(p);
            return {
              remove: () => withCycle((n) => { n.cycle.periods.splice(i, 1); }),
              cells: [
                datec(p, (e) => withCycle((n) => { n.cycle.periods[i] = e.target.value; })),
                plain(""),
              ],
            };
          }),
          add: () => withCycle((n) => { n.cycle.periods.push(iso(today)); }),
          addLabel: "+ Log a period start",
        }),
        notes("Privacy", "", [
          { t: "🔒 Your data", s: "Stored the same way as the rest of your planner data — private to your account, never shared or sold." },
        ]),
      ],
    };
  }

  // ===== shared task maths
  const liveTasks = d.tasks.filter((t) => t.status !== "Cancelled");
  const openTasks = liveTasks.filter((t) => t.status !== "Completed");
  const dueTodayTasks = openTasks.filter((t) => parseISO(t.due) === today);
  const overdueTasks = openTasks.filter((t) => { const x = parseISO(t.due); return x !== null && x < today; });
  const next7 = openTasks.filter((t) => { const x = parseISO(t.due); return x !== null && x >= today && x <= today + 7 * DAY; });
  const occToday = occurrences(d, today, today).filter((o) => !o.done);
  const occOverdue = lateOccurrences(d);
  const pctDone = liveTasks.length ? Math.round(100 * d.tasks.filter((t) => t.status === "Completed").length / liveTasks.length) : 0;

  // ===== money maths
  const mr = monthRange();
  const incomeIn = inRange(d.income, "date", mr.from, mr.to).reduce((s, x) => s + num(x.amount), 0);
  const billsIn = inRange(d.bills, "due", mr.from, mr.to).reduce((s, x) => s + num(x.actual), 0);
  const expIn = inRange(d.expenses, "date", mr.from, mr.to).reduce((s, x) => s + num(x.amount), 0);
  const out = billsIn + expIn;
  const left = incomeIn - out;
  const unpaidBills = d.bills.filter((b) => !b.paid);
  const expByCat = {};
  inRange(d.expenses, "date", mr.from, mr.to).forEach((x) => { expByCat[x.cat] = (expByCat[x.cat] || 0) + num(x.amount); });
  const catRows = Object.keys(expByCat).sort((a, b) => expByCat[b] - expByCat[a]);

  const sim = simulateDebt(d);
  const owed = d.debts.reduce((s, x) => s + num(x.balance), 0);
  const started = d.debts.reduce((s, x) => s + num(x.start), 0);

  // Dashboard's own habit rollup always reflects the real current month —
  // deliberately independent of whatever month Monthly Calendar/Habit
  // Tracker happen to be browsing, same principle monthRange() below
  // already follows for Spending's totals.
  const hs = habitStats(d, monthAnchorAt(0));
  const habitAvg = hs.length ? Math.round(hs.reduce((s, x) => s + x.pct, 0) / hs.length) : 0;
  const bestHabit = hs.map((x, i) => ({ n: d.habits[i].name, s: x.streak })).sort((a, b) => b.s - a.s)[0];

  const goalAvg = d.goals.length ? Math.round(d.goals.reduce((s, g) => s + (num(g.target) ? Math.min(100, 100 * num(g.current) / num(g.target)) : 0), 0) / d.goals.length) : 0;

  const wkFrom = weekBounds(d, state.week);
  const workoutsWk = d.workouts.filter((w) => { const t = parseISO(w.date); return t !== null && t >= wkFrom && t < wkFrom + 7 * DAY; });
  const volume = d.workouts.reduce((s, w) => s + num(w.sets) * num(w.reps) * num(w.weight), 0);
  const lastWeight = d.weights.length ? d.weights[d.weights.length - 1] : null;
  const bmi = lastWeight ? (d.settings.units === "Metric" ? num(lastWeight.kg) / Math.pow(num(d.settings.height) / 100, 2) : 703 * num(lastWeight.kg) / Math.pow(num(d.settings.height), 2)) : 0;

  const grocery = groceryRoll(d);
  const gotCount = grocery.filter((g) => d.got[g.name + "|" + g.unit]).length + d.extras.filter((x) => x.got).length;
  const groceryTotal = grocery.length + d.extras.length;

  // Falls back for accounts saved before this tab existed — same reasoning
  // as cycle/engagement elsewhere: never assume a field added after launch
  // is present on every existing account.
  const investments = d.investments || [];
  const investedTotal = investments.reduce((s, x) => s + num(x.invested), 0);
  const investCurrentTotal = investments.reduce((s, x) => s + num(x.current), 0);
  const investGain = investCurrentTotal - investedTotal;
  const investGainPct = investedTotal ? 100 * investGain / investedTotal : 0;

  // ===== Dashboard
  const ownName = d.settings.name && d.settings.name.trim() && d.settings.name.trim().toLowerCase() !== "me" ? d.settings.name.trim() : "";
  const gam = gamificationStats(d);
  // One combined, plain-language headline instead of two raw counts you'd
  // otherwise have to add together yourself (Recognition over recall) —
  // and it's the one thing on the page styled to stand out (Von Restorff),
  // so there's a single obvious answer to "what does today need from me."
  const attentionCount = dueTodayTasks.length + occToday.length + overdueTasks.length + occOverdue.length;
  const attentionOverdue = overdueTasks.length + occOverdue.length;
  const hero = {
    title: attentionCount === 0 ? "You're all caught up" : attentionCount + (attentionCount === 1 ? " thing needs" : " things need") + " your attention today",
    sub: attentionCount === 0 ? "Nothing due or overdue right now." : attentionOverdue ? attentionOverdue + " overdue, the rest due today." : "All due today — nothing overdue.",
    tone: attentionCount === 0 ? "health" : (attentionOverdue ? "home" : "money"),
  };
  P.dashboard = {
    title: "Dashboard", role: "Read only", roleTint: "people",
    sub: (ownName ? "Welcome back, " + ownName + ". " : "") + "Every number here is counted from the other tabs. Edit anything anywhere and this page follows.",
    greeting: greetingFor(ownName, today, d.settings.birthday),
    hero,
    // Capped at four (Miller's Law) and limited to the numbers that change
    // how you'd act today — trend/motivational stats moved to `progress`
    // below instead of competing here at equal weight (Progressive
    // Disclosure: today's status first, everything else one glance later).
    kpis: [
      { label: "Tasks complete", value: pctDone + "%", note: d.tasks.filter((t) => t.status === "Completed").length + " of " + liveTasks.length, hasBar: true, pct: pctDone, explain: "Completed one-off tasks (from Task Tracker) divided by all your non-cancelled tasks." },
      { label: "Habits", value: habitAvg + "%", note: bestHabit ? bestHabit.n + " · " + bestHabit.s + " days" : "", tint: "health", hasBar: true, pct: habitAvg, explain: "Average completion rate across all habits this month, from the Habit Tracker." },
      { label: "Goal progress", value: goalAvg + "%", note: d.goals.length + " goals", tint: "work", hasBar: true, pct: goalAvg, explain: "Average of every goal's current value divided by its target, from Overview." },
      {
        label: "Left to spend", value: mon(left), note: mon(incomeIn) + " in", tint: left < 0 ? "home" : "money",
        explain: "This month's income minus paid bills and logged expenses.",
        // A negative balance is exactly the moment someone's motivated to
        // look closer — this puts the actual next step (not just a red
        // number) right where that motivation already is, instead of
        // leaving it to a separate tab switch.
        link: left < 0 ? { label: "Review spending →", tab: "spending" } : null,
      },
    ],
    // De-emphasized on purpose: motivational/trend stats, not today's
    // status — shown smaller and later so they don't compete with the
    // hero (Progressive Disclosure), in a quieter style than the KPI row
    // to match a calm/trustworthy tone rather than a game-like one.
    progress: [
      { label: "Investments", value: mon(investCurrentTotal), note: investments.length ? (investGain >= 0 ? "+" : "") + mon(investGain) + " (" + Math.round(investGainPct) + "%)" : "no holdings yet" },
      { label: "Points", value: String(gam.points), note: gam.badgesEarned + " of " + gam.badges.length + " badges" },
      { label: "Day streak", value: String(gam.loginStreak), note: gam.loginStreak ? "days in a row" : "open it again tomorrow" },
    ],
    blocks: [
      table({
        title: "Due today and overdue", note: "tick a recurring one and it rolls forward",
        grid: "34px 2fr 120px 120px 130px 1fr",
        head: ["", "Task", "Category", "Priority", "Source", "When"],
        rows: overdueTasks.concat(dueTodayTasks).map((t) => {
          const i = d.tasks.indexOf(t);
          const late = parseISO(t.due) < today;
          const daysLate = late ? Math.round((today - parseISO(t.due)) / DAY) : 0;
          return {
            cells: [
              tog(false, () => patch((n) => { n.tasks[i].status = "Completed"; }), "health"),
              plain(t.name, { tint: late ? "home" : "", tinted: late }),
              chip(t.cat, CAT_TINT[t.cat]),
              chip(t.prio, PRIO_TINT[t.prio]),
              plain("Task Tracker", { muted: true }),
              plain(late ? daysLate + (daysLate === 1 ? " day late" : " days late") : "today", { muted: !late, tint: late ? "home" : "" }),
            ],
          };
        }).concat(occOverdue.concat(occToday).map((o) => {
          const overdue = o.at < today;
          const daysLate = overdue ? Math.round((today - o.at) / DAY) : 0;
          return {
            cells: [
              tog(false, () => catchUp(o.ri, o.oi), "health"),
              plain(o.task.name, { tint: overdue ? "home" : "", tinted: overdue }),
              chip(o.task.cat, CAT_TINT[o.task.cat]),
              chip(o.task.prio, PRIO_TINT[o.task.prio]),
              plain("Recurring", { muted: true }),
              plain(overdue ? daysLate + (daysLate === 1 ? " day late" : " days late") : "today", { muted: !overdue, tint: overdue ? "home" : "" }),
            ],
          };
        })),
      }),
      donut("Money this month", "in the shown month", mon(out), "out", [
        { label: "Bills", n: billsIn, value: mon(billsIn), tint: "money" },
        { label: "Everyday expenses", n: expIn, value: mon(expIn), tint: "work" },
        { label: "Left over", n: Math.max(0, left), value: mon(left), tint: "health" },
      ]),
      columns("Habit rate", "this month, per habit", d.habits.map((h, i) => ({ label: h.name.split(" ")[0], n: hs[i].pct, value: hs[i].pct + "%", tint: h.tint }))),
      badges("Badges", "points: 10 per task, 15 per focus session, 5 per habit tick", gam.badges),
    ],
  };
  // Exposed separately (not just buried in the KPI card) so App.jsx can
  // watch it for a badge-earned celebration without re-deriving gamification
  // logic — see the celebrate-burst effect there.
  P.dashboard.badgesEarned = gam.badgesEarned;

  // ===== Today / Day detail — everything tied to one date, gathered from
  // every other tab. Nothing here is its own source of truth: ticking a
  // row just calls the same patch the owning tab (Task Tracker, Recurring,
  // Bills, Habit Tracker, Expenses) would call itself, so there's exactly
  // one place each fact actually lives. Defaults to today; clicking a day
  // on the Monthly Calendar points it at that date instead via
  // state.dayView (an ISO string) so the same page works as a day-detail
  // view for any date, not just today.
  const viewTs = state.dayView ? parseISO(state.dayView) : today;
  const viewISO = iso(viewTs);
  const isViewingToday = viewTs === today;

  const allTasksView = liveTasks.filter((t) => parseISO(t.due) === viewTs);
  const openTasksView = allTasksView.filter((t) => t.status !== "Completed");
  const doneTasksView = allTasksView.filter((t) => t.status === "Completed");
  const occViewAll = occurrences(d, viewTs, viewTs);
  const occViewOpen = occViewAll.filter((o) => !o.done);
  const occViewDone = occViewAll.filter((o) => o.done);
  const allBillsView = d.bills.filter((b) => parseISO(b.due) === viewTs);
  const billsView = allBillsView.filter((b) => !b.paid);
  const paidBillsView = allBillsView.filter((b) => b.paid);
  const viewAnchor = new Date(anchor);
  const viewDateObj = new Date(viewTs);
  const monthMatchesView = viewAnchor.getMonth() === viewDateObj.getMonth() && viewAnchor.getFullYear() === viewDateObj.getFullYear();
  const domView = viewDateObj.getDate();
  // `h.days` is keyed by day-of-month alone, with no month/year attached —
  // monthMatchesView guards against misreading a past/future calendar
  // day's number against the wrong month when browsing via the Monthly
  // Calendar. But Today itself is never ambiguous this way, and gating it
  // on whatever month Overview's calendar happens to be scrolled to meant
  // habits could silently vanish from your own actual Today the moment
  // the real month rolled over past whatever Overview was last set to.
  const habitsAllView = (isViewingToday || monthMatchesView) ? d.habits.map((h, hi) => ({ h, hi })) : [];
  const habitsView = habitsAllView.filter(({ h }) => !h.days[domView]);
  const habitsDoneView = habitsAllView.filter(({ h }) => h.days[domView]);

  // A planned workout is part of today just as much as a task or habit —
  // "Rest" days (the default when nothing's set) don't count as something
  // to check off. Uses the same Mon-first day index the Fitness tab's
  // split table itself is keyed by, independent of the Week-starts-on
  // setting (that setting only affects calendar/planner display, not this
  // template). Logging it here just adds a real row to Workouts, the same
  // "ticking here ticks it there too" pattern every other row follows.
  const splitDayIndex = (viewDateObj.getDay() + 6) % 7;
  const splitFocusView = (d.split || {})[splitDayIndex + "-0"] || "Rest";
  const workoutLoggedView = d.workouts.some((w) => parseISO(w.date) === viewTs);
  const workoutPlannedView = splitFocusView !== "Rest";

  // Ticking something here doesn't remove it — it moves to the bottom,
  // struck through, so the list reads as a real record of today (what's
  // still open, then what you already did) instead of items just
  // vanishing the moment you check them off.
  const openRows = []
    .concat(workoutPlannedView && !workoutLoggedView ? [{
      cells: [
        tog(false, () => patch((n) => { n.workouts.push({ date: viewISO, who: "Me", ex: splitFocusView + " session", focus: splitFocusView, sets: 0, reps: 0, weight: 0 }); }), "work"),
        plain(splitFocusView + " workout"), chip("Fitness", "work"), plain("Fitness", { muted: true }),
      ],
    }] : [])
    .concat(openTasksView.map((t) => {
      const i = d.tasks.indexOf(t);
      return { cells: [tog(false, () => patch((n) => { n.tasks[i].status = "Completed"; }), "health"), plain(t.name), chip(t.cat, CAT_TINT[t.cat]), plain("Task", { muted: true })] };
    }))
    .concat(occViewOpen.map((o) => ({
      cells: [tog(false, () => catchUp(o.ri, o.oi), "health"), plain(o.task.name), chip(o.task.cat, CAT_TINT[o.task.cat]), plain("Recurring", { muted: true })],
    })))
    .concat(billsView.map((b) => {
      const i = d.bills.indexOf(b);
      return { cells: [tog(false, () => patch((n) => { n.bills[i].paid = true; }), "money"), plain(b.name), chip(b.cat, "money"), plain("Bill", { muted: true })] };
    }))
    .concat(habitsView.map(({ h, hi }) => ({
      cells: [tog(false, () => patch((n) => { n.habits[hi].days[domView] = true; }), h.tint), plain(h.name), chip("Habit", h.tint), plain("Habit Tracker", { muted: true })],
    })));

  const doneRows = []
    .concat(workoutPlannedView && workoutLoggedView ? [{
      // Undo only removes the placeholder session this checklist itself
      // logged (matched by date + the auto-generated exercise name), not
      // a real workout someone already logged by hand in the Fitness tab
      // for the same day — that one has actual sets/reps worth keeping,
      // so tapping here again leaves it alone rather than deleting it.
      cells: [
        tog(true, () => patch((n) => {
          const idx = n.workouts.findIndex((w) => w.date === viewISO && w.ex === splitFocusView + " session");
          if (idx > -1) n.workouts.splice(idx, 1);
        }), "work"),
        plain(splitFocusView + " workout", { muted: true, strike: true }), chip("Fitness", "work"), plain("Fitness", { muted: true }),
      ],
    }] : [])
    .concat(doneTasksView.map((t) => {
      const i = d.tasks.indexOf(t);
      return { cells: [tog(true, () => patch((n) => { n.tasks[i].status = "Not Started"; }), "health"), plain(t.name, { muted: true, strike: true }), chip(t.cat, CAT_TINT[t.cat]), plain("Task", { muted: true })] };
    }))
    .concat(occViewDone.map((o) => ({
      cells: [tog(true, () => patch((n) => { delete n.done[o.ri + ":" + o.oi]; }), "health"), plain(o.task.name, { muted: true, strike: true }), chip(o.task.cat, CAT_TINT[o.task.cat]), plain("Recurring", { muted: true })],
    })))
    .concat(paidBillsView.map((b) => {
      const i = d.bills.indexOf(b);
      return { cells: [tog(true, () => patch((n) => { n.bills[i].paid = false; }), "money"), plain(b.name, { muted: true, strike: true }), chip(b.cat, "money"), plain("Bill", { muted: true })] };
    }))
    .concat(habitsDoneView.map(({ h, hi }) => ({
      cells: [tog(true, () => patch((n) => { delete n.habits[hi].days[domView]; }), h.tint), plain(h.name, { muted: true, strike: true }), chip("Habit", h.tint), plain("Habit Tracker", { muted: true })],
    })));

  const dayRows = openRows.concat(doneRows);
  const dayOpen = openRows.length;
  const dayDone = doneRows.length;
  const dayTotal = dayOpen + dayDone;
  const dayPct = dayTotal ? Math.round(100 * dayDone / dayTotal) : 100;
  const sessionsView = (d.focusSessions && d.focusSessions[viewISO]) || 0;

  const daySpend = d.expenses.filter((x) => parseISO(x.date) === viewTs);
  const daySpendTotal = daySpend.reduce((s, x) => s + num(x.amount), 0);

  const healthSynced = !!(d.health && (
    Object.keys(d.health.steps || {}).length || Object.keys(d.health.sleepHours || {}).length
  ));

  P.today = {
    title: isViewingToday ? "Today" : fmtDate(viewTs), role: isViewingToday ? "Check off as you go" : "Day detail", roleTint: "accent",
    sub: isViewingToday
      ? "Pulled together from Task Tracker, Bills, Habit Tracker, and your Fitness split — tick something here and it's ticked there too."
      : "Whatever was (or is) due that day, its journal entry, and its spending — clicked from the Monthly Calendar.",
    greeting: isViewingToday ? greetingFor(ownName, today, d.settings.birthday) : null,
    kpis: [
      { label: "Still open", value: String(dayOpen), note: dayOpen ? "left" : "all clear", tint: dayOpen ? "" : "health", explain: "Rows still showing in the checklist below." },
      { label: "Focus sessions", value: String(sessionsView), note: isViewingToday ? "today" : "that day", tint: "work", explain: "30-minute focus timer sessions completed, from the timer above." },
      { label: "Spent", value: mon(daySpendTotal), note: daySpend.length + " logged", tint: daySpendTotal ? "money" : "" , explain: "Logged in the Spending table below, for this date only." },
      // Steps/Sleep depend on a manual Apple Shortcuts setup (see Overview's
      // Health Sync card) — most visitors never do it, so these only join
      // the row once there's at least one synced day, same as .fasting-timer
      // only rendering when settings.fasts === "Yes" in App.jsx.
      ...(healthSynced ? [
        {
          label: "Steps", value: d.health?.steps?.[viewISO] != null ? String(d.health.steps[viewISO]) : "—",
          note: "from Health via Shortcuts", explain: "Sent in by an Apple Shortcut you set up on Overview — not tracked directly in Align.",
        },
        {
          label: "Sleep", value: d.health?.sleepHours?.[viewISO] != null ? d.health.sleepHours[viewISO] + "h" : "—",
          note: "from Health via Shortcuts", explain: "Sent in by an Apple Shortcut you set up on Overview — not tracked directly in Align.",
        },
      ] : []),
    ],
    blocks: [
      donut("Progress", "everything due that day", dayPct + "%", dayDone + " of " + dayTotal, [
        { label: "Done", n: dayDone, value: String(dayDone), tint: "health" },
        { label: "Still open", n: dayOpen, value: String(dayOpen), tint: "" },
      ]),
      table({
        title: "Checklist", note: dayOpen ? dayOpen + " left" : "nothing left",
        emptyLabel: "All clear", emptyNote: isViewingToday ? "Nothing due today — enjoy it." : "Nothing was due that day.",
        grid: "34px 2fr 130px 140px",
        head: ["", "Item", "Category", "Source"],
        rows: dayRows,
      }),
      table({
        title: "Spending", note: daySpend.length ? mon(daySpendTotal) + " so far" : "nothing logged yet",
        grid: "1.8fr 150px 120px",
        head: ["Description", "Category", { t: "Amount", align: "right" }],
        rows: daySpend.map((x) => {
          const i = d.expenses.indexOf(x);
          return {
            remove: () => patch((n) => n.expenses.splice(i, 1)),
            cells: [
              edit(x.desc, (e) => patch((n) => { n.expenses[i].desc = txt(e); })),
              sel(x.cat, (e) => patch((n) => { n.expenses[i].cat = e.target.value; }), EXP_CATS, EXP_TINT[x.cat]),
              numc(x.amount, (e) => patch((n) => { n.expenses[i].amount = num(e.target.value); }), { step: "0.01" }),
            ],
          };
        }),
        add: () => patch((n) => n.expenses.push({ date: viewISO, desc: "New expense", cat: "Groceries", how: "Debit card", amount: 0 })),
        addLabel: "+ Log spending",
        voiceAdd: (text) => patch((n) => n.expenses.push({ date: viewISO, desc: text, cat: "Groceries", how: "Debit card", amount: 0 })),
      }),
      notes(isViewingToday ? "Today's meals" : "Meals that day", DAYNAMES[(viewDateObj.getDay() + 6) % 7], ["Breakfast", "Lunch", "Dinner", "Snacks"].map((label, mi) => {
        const di = (viewDateObj.getDay() + 6) % 7;
        return { t: label, s: d.meals[di + "-" + mi] || "Not planned" };
      })),
    ],
  };

  // ===== Task Tracker
  // One-off and recurring tasks used to be two separate tabs with nothing
  // in common but the word "task" — genuinely different data underneath
  // (a due date vs. a frequency that generates future occurrences), which
  // is why they still get their own tables below rather than one merged
  // list. But there's no reason that split has to cost a whole extra tab:
  // Recurring never had its own KPI row, so putting both tables on one
  // page loses nothing and removes a destination that mostly just made
  // "where do I add a task" a two-way guess.
  // Generated schedule's source rows, computed once here so both that
  // table and Repeating tasks' datelink cells (which need "how many
  // occurrences does this template have upcoming") read the same list.
  const scheduleOccs = lateOccurrences(d).concat(occurrences(d, today, today + 120 * DAY).filter((o) => !o.done)).slice(0, 12);

  P.tasks = {
    title: "Task Tracker", role: "Type freely", roleTint: "health",
    sub: "One-off tasks above, anything that repeats on a schedule below. Days left and next-due dates calculate themselves.",
    kpis: [
      { label: "Total tasks", value: String(liveTasks.length), note: "", explain: "One-off tasks that aren't cancelled — open and completed combined." },
      { label: "% complete", value: pctDone + "%", note: "", hasBar: true, pct: pctDone, explain: "Completed one-off tasks divided by all non-cancelled tasks." },
      {
        label: "Overdue", value: String(overdueTasks.length), note: "", tint: overdueTasks.length ? "home" : "health",
        explain: overdueTasks.length ? "Tap to jump to these rows in All tasks." : "Nothing open is past its due date.",
        jump: overdueTasks.length ? { blockId: "all-tasks", ids: overdueTasks.map((t) => "task-" + d.tasks.indexOf(t)) } : null,
      },
      {
        label: "Due today", value: String(dueTodayTasks.length), note: "",
        explain: dueTodayTasks.length ? "Tap to jump to these rows in All tasks." : "Nothing open is due today.",
        jump: dueTodayTasks.length ? { blockId: "all-tasks", ids: dueTodayTasks.map((t) => "task-" + d.tasks.indexOf(t)) } : null,
      },
      { label: "Next 7 days", value: String(next7.length), note: "", explain: "Open tasks due within the next week, not counting today." },
      { label: "Recurring", value: String(d.recurring.length), note: "", explain: "Templates in Repeating tasks below — each generates its own occurrences in Generated schedule." },
    ],
    blocks: [
      table({
        title: "All tasks", note: "everything here is editable",
        emptyLabel: "No tasks yet", emptyNote: "Add one below — every field updates the Dashboard automatically.",
        grid: "1.5fr 1.4fr 110px 110px 130px 100px 130px 100px 90px",
        head: ["Task", "Description", "Category", "Priority", "Status", "Owner", "Due date", "Remind at", { t: "Days left", align: "right" }],
        rows: d.tasks.map((t, i) => {
          const due = parseISO(t.due);
          const closed = t.status === "Completed" || t.status === "Cancelled";
          const days = (due === null || closed) ? "—" : Math.round((due - today) / DAY);
          const late = !closed && due !== null && due < today;
          return {
            id: "task-" + i,
            remove: () => patch((n) => n.tasks.splice(i, 1)),
            cells: [
              edit(t.name, (e) => patch((n) => { n.tasks[i].name = txt(e); })),
              edit(t.desc, (e) => patch((n) => { n.tasks[i].desc = txt(e); })),
              sel(t.cat, (e) => patch((n) => { n.tasks[i].cat = e.target.value; }), CATS, CAT_TINT[t.cat]),
              sel(t.prio, (e) => patch((n) => { n.tasks[i].prio = e.target.value; }), PRIOS, PRIO_TINT[t.prio]),
              sel(t.status, (e) => patch((n) => { n.tasks[i].status = e.target.value; }), STATUSES, STATUS_TINT[t.status]),
              sel(t.who, (e) => patch((n) => { n.tasks[i].who = e.target.value; }), PEOPLE),
              datec(t.due, (e) => patch((n) => { n.tasks[i].due = e.target.value; })),
              timec(t.reminderTime || "", (e) => patch((n) => { n.tasks[i].reminderTime = e.target.value; })),
              plain(String(days), { align: "right", tint: late ? "home" : "", tinted: late, muted: closed }),
            ],
          };
        }),
        add: () => patch((n) => n.tasks.push({ id: crypto.randomUUID(), name: "New task", desc: "", cat: "Personal", prio: "Medium", status: "Not Started", who: "Me", due: iso(today), est: "", reminderTime: "" })),
        addLabel: "+ New task",
        voiceAdd: (text) => patch((n) => n.tasks.push({ id: crypto.randomUUID(), name: text, desc: "", cat: "Personal", prio: "Medium", status: "Not Started", who: "Me", due: iso(today), est: "", reminderTime: "" })),
      }),
      table({
        title: "Repeating tasks", note: "next due skips anything already ticked off",
        emptyLabel: "No recurring tasks yet", emptyNote: "Add a chore or routine that repeats on a schedule.",
        grid: "1.6fr 110px 110px 100px 130px 150px 110px 130px 100px",
        head: ["Task", "Category", "Priority", "Owner", "First due", "Frequency", { t: "Every", align: "right" }, "Next due", "Remind at"],
        rows: d.recurring.map((r, i) => {
          const nd = nextDue(d, i);
          const every = RECUR_MONTHS[r.freq] ? RECUR_MONTHS[r.freq] + " mo" : (RECUR_DAYS[r.freq] || 0) + (RECUR_DAYS[r.freq] === 1 ? " day" : " days");
          const matches = scheduleOccs.filter((o) => o.ri === i);
          return {
            id: "recur-" + i,
            remove: () => patch((n) => n.recurring.splice(i, 1)),
            cells: [
              edit(r.name, (e) => patch((n) => { n.recurring[i].name = txt(e); })),
              sel(r.cat, (e) => patch((n) => { n.recurring[i].cat = e.target.value; }), CATS, CAT_TINT[r.cat]),
              sel(r.prio, (e) => patch((n) => { n.recurring[i].prio = e.target.value; }), PRIOS, PRIO_TINT[r.prio]),
              sel(r.who, (e) => patch((n) => { n.recurring[i].who = e.target.value; }), PEOPLE),
              datec(r.first, (e) => patch((n) => { n.recurring[i].first = e.target.value; })),
              sel(r.freq, (e) => patch((n) => { n.recurring[i].freq = e.target.value; }), RECUR, "work"),
              plain(every, { align: "right", muted: true }),
              datelink(
                fmtDate(nd), { tint: nd === today ? "money" : "", tinted: nd === today }, matches.length,
                () => triggerHighlight(matches.map((o) => "occ-" + o.ri + "-" + o.oi), "generated-schedule"),
              ),
              timec(r.reminderTime || "", (e) => patch((n) => { n.recurring[i].reminderTime = e.target.value; })),
            ],
          };
        }),
        add: () => patch((n) => n.recurring.push({ name: "New recurring task", cat: "Home", prio: "Medium", who: "Me", first: iso(today), freq: "Weekly", reminderTime: "" })),
        addLabel: "+ New recurring task",
      }),
      table({
        title: "Generated schedule", note: "next twelve occurrences · tick one and it disappears",
        grid: "34px 1.8fr 130px 150px 90px 130px 1fr",
        head: ["", "Task", "Category", "Due date", { t: "#", align: "right" }, "Owner", "Status"],
        rows: scheduleOccs.map((o) => ({
          id: "occ-" + o.ri + "-" + o.oi,
          cells: [
            tog(false, () => catchUp(o.ri, o.oi), "health"),
            plain(o.task.name),
            chip(o.task.cat, CAT_TINT[o.task.cat]),
            plain(fmtDate(o.at), { muted: o.at > today }),
            plain(String(o.oi + 1), { align: "right", muted: true }),
            plain(o.task.who, { muted: true }),
            chip(o.at < today ? "Missed" : (o.at === today ? "Due today" : "Upcoming"), o.at < today ? "home" : (o.at === today ? "money" : "")),
          ],
        })),
      }),
    ],
  };

  // ===== Monthly Calendar
  const ad = new Date(anchor);
  const lead = (ad.getDay() - wkStart(d) + 7) % 7;
  const gridStart = anchor - lead * DAY;
  const monthLen = new Date(ad.getFullYear(), ad.getMonth() + 1, 0).getDate();
  const occMonth = occurrences(d, gridStart, gridStart + 41 * DAY);
  const cellCount = lead + monthLen > 35 ? 42 : 35;
  const days = [];
  for (let i = 0; i < cellCount; i++) {
    const at = gridStart + i * DAY;
    const dd = new Date(at);
    const evs = [];
    openTasks.forEach((t) => { if (parseISO(t.due) === at) evs.push({ t: t.name, tint: CAT_TINT[t.cat] || "" }); });
    occMonth.forEach((o) => { if (o.at === at && !o.done) evs.push({ t: o.task.name, tint: CAT_TINT[o.task.cat] || "" }); });
    d.bills.forEach((b) => { if (!b.paid && parseISO(b.due) === at) evs.push({ t: b.name, tint: "money" }); });
    d.goals.forEach((g) => { if (parseISO(g.date) === at) evs.push({ t: g.name, tint: "home" }); });
    d.savings.forEach((s) => { if (parseISO(s.date) === at) evs.push({ t: s.name, tint: "home" }); });
    days.push({
      n: String(dd.getDate()),
      dim: dd.getMonth() !== ad.getMonth(),
      today: at === today,
      numColor: at === today ? "var(--color-accent)" : "var(--color-neutral-500)",
      more: evs.length > 2 ? "+" + (evs.length - 2) : "",
      events: evs.slice(0, 2),
      onClick: () => goToDay(iso(at)),
    });
  }
  const dayNames = DAYNAMES.slice(wkStart(d) === 0 ? 6 : 0).concat(wkStart(d) === 0 ? DAYNAMES.slice(0, 6) : []);
  P.calendar = {
    title: fmtMon(anchor), role: "Browse any month with the buttons below", roleTint: "money",
    sub: "Tasks, recurring occurrences, unpaid bills and target dates, all drawn from the tabs that own them. Nothing on this page is typed.",
    blocks: [
      calendarBlock("Month", "up to two per day, then a count", dayNames, days),
      notes("What lands here", "", [
        { t: "Open tasks", s: "From Task Tracker, unless the status is Completed or Cancelled." },
        { t: "Recurring occurrences", s: "Projected from each frequency, hidden once ticked off." },
        { t: "Unpaid bills", s: "They vanish the moment you mark one paid." },
        { t: "Target dates", s: "Goal and savings deadlines, so nothing sneaks up." },
      ]),
    ],
  };

  // ===== Weekly
  const wkCells = [];
  wkCells.push({ kind: "plain", v: "" });
  for (let i = 0; i < 7; i++) {
    const at = wkFrom + i * DAY;
    const dd = new Date(at);
    wkCells.push({ kind: "plain", v: DAYNAMES[(wkStart(d) + i) % 7] + " " + dd.getDate(), today: at === today });
  }
  const wkOcc = occurrences(d, wkFrom, wkFrom + 6 * DAY);
  wkCells.push({ kind: "plain", v: "due", muted: true });
  for (let i = 0; i < 7; i++) {
    const at = wkFrom + i * DAY;
    // Names, not just the count, so the due cell can show what's actually
    // due on tap instead of leaving you to go check Task Tracker to know
    // what to type into the grid below.
    const dueNames = openTasks.filter((t) => parseISO(t.due) === at).map((t) => t.name)
      .concat(wkOcc.filter((o) => o.at === at && !o.done).map((o) => o.task.name));
    wkCells.push({
      kind: "plain", v: dueNames.length ? dueNames.length + " due" : "", tint: dueNames.length ? "accent" : "", tinted: !!dueNames.length,
      today: at === today, names: dueNames.length ? dueNames : null,
    });
  }
  HOURS.forEach((h) => {
    wkCells.push({ kind: "plain", v: h, muted: true });
    for (let i = 0; i < 7; i++) {
      const at = wkFrom + i * DAY;
      const key = state.week + "|" + i + "|" + h;
      wkCells.push({
        kind: "edit", v: d.blocks[key] || "",
        set: ((k) => (e) => patch((n) => { n.blocks[k] = e.target.textContent; }))(key),
        today: at === today,
      });
    }
  });
  const blocked = Object.keys(d.blocks).filter((k) => k.indexOf(state.week + "|") === 0 && d.blocks[k]).length;
  P.weekly = {
    title: "Weekly Planner", role: "Type in the grid", roleTint: "money",
    sub: "The due row is calculated from your tasks. The time grid below is yours to type in — it saves per week.",
    kpis: [
      { label: "Blocked slots", value: String(blocked), note: "of " + (HOURS.length * 7) },
      { label: "Free slots", value: String(HOURS.length * 7 - blocked), note: "", tint: "health" },
      { label: "Due this week", value: String(openTasks.filter((t) => { const x = parseISO(t.due); return x !== null && x >= wkFrom && x < wkFrom + 7 * DAY; }).length + wkOcc.filter((o) => !o.done).length), note: "" },
      { label: "Workouts", value: String(workoutsWk.length), note: "logged this week", tint: "health" },
    ],
    blocks: [
      weekBlock(fmtDate(wkFrom) + " – " + fmtDate(wkFrom + 6 * DAY), "click any cell and type", wkCells),
    ],
    weekOffset: state.week,
    setWeek,
  };

  // ===== Income
  P.income = {
    title: "Income", role: "Type freely", roleTint: "health",
    sub: "Everything coming in. The Spending tab totals whatever falls inside the shown month.",
    kpis: [
      { label: "This month", value: mon(incomeIn), note: "", explain: "Everything below with a date in the current calendar month." },
      { label: "Entries", value: String(inRange(d.income, "date", mr.from, mr.to).length), note: "", explain: "How many rows below fall in the current calendar month." },
      { label: "All time", value: mon(d.income.reduce((s, x) => s + num(x.amount), 0)), note: d.income.length + " entries", explain: "Every entry below, added up, regardless of date." },
    ],
    blocks: [
      table({
        title: "Entries", note: "",
        grid: "150px 1.8fr 150px 140px 1.4fr",
        head: ["Date", "Source", "Type", { t: "Amount", align: "right" }, "Notes"],
        rows: d.income.map((x, i) => ({
          remove: () => patch((n) => n.income.splice(i, 1)),
          cells: [
            datec(x.date, (e) => patch((n) => { n.income[i].date = e.target.value; })),
            edit(x.source, (e) => patch((n) => { n.income[i].source = txt(e); })),
            sel(x.type, (e) => patch((n) => { n.income[i].type = e.target.value; }), INCOME_TYPES, "health"),
            numc(x.amount, (e) => patch((n) => { n.income[i].amount = num(e.target.value); })),
            edit(x.note, (e) => patch((n) => { n.income[i].note = txt(e); })),
          ],
        })),
        add: () => patch((n) => n.income.push({ date: iso(today), source: "New income", type: "Paycheck", amount: 0, note: "" })),
        addLabel: "+ New entry",
      }),
    ],
  };

  // ===== Bills
  P.bills = {
    title: "Bills", role: "Type freely", roleTint: "health",
    sub: "Fixed commitments. Tick Paid and the bill drops off the calendar; leave it and an overdue one turns red.",
    kpis: [
      { label: "Budgeted", value: mon(d.bills.reduce((s, b) => s + num(b.budget), 0)), note: d.bills.length + " bills", explain: "Sum of every bill's budgeted amount below." },
      { label: "Actual", value: mon(d.bills.reduce((s, b) => s + num(b.actual), 0)), note: "", explain: "Sum of every bill's actual amount, once you've filled it in." },
      { label: "Unpaid", value: mon(unpaidBills.reduce((s, b) => s + num(b.budget), 0)), note: unpaidBills.length + " bills", tint: unpaidBills.length ? "money" : "health", explain: "Budgeted total for bills not yet marked Paid." },
      (() => {
        const overdueBills = unpaidBills.filter((b) => parseISO(b.due) !== null && parseISO(b.due) < today);
        return {
          label: "Overdue", value: String(overdueBills.length), note: "", tint: "home",
          explain: overdueBills.length ? "Tap to jump to these rows in Commitments." : "Nothing unpaid is past its due date.",
          jump: overdueBills.length ? { blockId: "commitments", ids: overdueBills.map((b) => "bill-" + d.bills.indexOf(b)) } : null,
        };
      })(),
    ],
    blocks: [
      table({
        title: "Commitments", note: "",
        grid: "1.5fr 120px 110px 130px 110px 110px 100px 70px",
        head: ["Bill", "Category", "Frequency", "Due date", { t: "Budgeted", align: "right" }, { t: "Actual", align: "right" }, "Remind at", "Paid"],
        rows: d.bills.map((b, i) => {
          const late = !b.paid && parseISO(b.due) !== null && parseISO(b.due) < today;
          return {
            id: "bill-" + i,
            remove: () => patch((n) => n.bills.splice(i, 1)),
            cells: [
              edit(b.name, (e) => patch((n) => { n.bills[i].name = txt(e); })),
              sel(b.cat, (e) => patch((n) => { n.bills[i].cat = e.target.value; }), EXP_CATS, EXP_TINT[b.cat]),
              sel(b.freq, (e) => patch((n) => { n.bills[i].freq = e.target.value; }), RECUR),
              datec(b.due, (e) => patch((n) => { n.bills[i].due = e.target.value; })),
              numc(b.budget, (e) => patch((n) => { n.bills[i].budget = num(e.target.value); })),
              numc(b.actual, (e) => patch((n) => { n.bills[i].actual = num(e.target.value); }), { tint: num(b.actual) > num(b.budget) ? "home" : "", tinted: num(b.actual) > num(b.budget) }),
              timec(b.reminderTime || "", (e) => patch((n) => { n.bills[i].reminderTime = e.target.value; })),
              tog(b.paid, () => patch((n) => { n.bills[i].paid = !n.bills[i].paid; if (n.bills[i].paid && !num(n.bills[i].actual)) n.bills[i].actual = num(n.bills[i].budget); }), late ? "home" : "health"),
            ],
          };
        }),
        add: () => patch((n) => n.bills.push({ id: crypto.randomUUID(), name: "New bill", cat: "Utilities", freq: "Monthly", due: iso(today), budget: 0, actual: 0, paid: false, reminderTime: "" })),
        addLabel: "+ New bill",
      }),
    ],
  };

  // ===== Spending
  // Merges what used to be two separate tabs (Budget, Expenses) that both
  // rendered a "planned vs. actual by category" table off the exact same
  // `d.budgets` data — one editable, one read-only, showing the same
  // numbers twice. One tab, one budget table (editable, with the Diff
  // column the read-only version had), instead of two.
  P.spending = {
    title: "Spending", role: "Type freely", roleTint: "money",
    sub: "Everything variable, plus how it stacks up against what you planned. Bills are tracked separately since they're fixed commitments, not day-to-day spending.",
    kpis: [
      { label: "This month", value: mon(expIn), note: inRange(d.expenses, "date", mr.from, mr.to).length + " entries", explain: "Everyday expenses below with a date in the current calendar month — bills aren't counted here." },
      { label: "Left to spend", value: mon(left), note: "income minus bills & expenses", tint: left < 0 ? "home" : "health", explain: "This month's income minus paid bills and logged expenses." },
      { label: "Savings rate", value: (incomeIn ? Math.round(100 * left / incomeIn) : 0) + "%", note: "", hasBar: true, pct: incomeIn ? 100 * left / incomeIn : 0, tint: "health", explain: "Left to spend as a percentage of this month's income." },
      { label: "Biggest category", value: catRows.length ? catRows[0] : "—", note: catRows.length ? mon(expByCat[catRows[0]]) : "", explain: "The expense category with the highest total this month." },
    ],
    blocks: [
      donut("Where it goes", fmtMon(anchor), mon(incomeIn), "in", [
        { label: "Bills", n: billsIn, value: mon(billsIn), tint: "money" },
        { label: "Everyday expenses", n: expIn, value: mon(expIn), tint: "work" },
        { label: "Left over", n: Math.max(0, left), value: mon(left), tint: "health" },
      ]),
      table({
        title: "Entries", note: "newest first",
        grid: "150px 1.8fr 150px 140px 130px",
        head: ["Date", "Description", "Category", "Paid with", { t: "Amount", align: "right" }],
        rows: d.expenses.slice().sort((a, b) => (parseISO(b.date) || 0) - (parseISO(a.date) || 0)).slice(0, 14).map((x) => {
          const i = d.expenses.indexOf(x);
          return {
            remove: () => patch((n) => n.expenses.splice(i, 1)),
            cells: [
              datec(x.date, (e) => patch((n) => { n.expenses[i].date = e.target.value; })),
              edit(x.desc, (e) => patch((n) => { n.expenses[i].desc = txt(e); })),
              sel(x.cat, (e) => patch((n) => { n.expenses[i].cat = e.target.value; }), EXP_CATS, EXP_TINT[x.cat]),
              sel(x.how, (e) => patch((n) => { n.expenses[i].how = e.target.value; }), ["Debit card", "Credit card", "Cash", "Transfer", "Direct debit"]),
              numc(x.amount, (e) => patch((n) => { n.expenses[i].amount = num(e.target.value); })),
            ],
          };
        }),
        add: () => patch((n) => n.expenses.unshift({ date: iso(today), desc: "New expense", cat: "Groceries", how: "Debit card", amount: 0 })),
        addLabel: "+ New expense",
        voiceAdd: (text) => patch((n) => n.expenses.unshift({ date: iso(today), desc: text, cat: "Groceries", how: "Debit card", amount: 0 })),
      }),
      table({
        title: "Against your budget", note: "planned vs. actual, editable",
        grid: "1.8fr 140px 140px 140px 1fr",
        head: ["Category", { t: "Planned", align: "right" }, { t: "Actual", align: "right" }, { t: "Diff", align: "right" }, "Used"],
        rows: d.budgets.map((b, i) => {
          const actual = expByCat[b.cat] || 0;
          const planned = num(b.planned);
          const diff = actual - planned;
          const used = planned ? 100 * actual / planned : 0;
          return {
            remove: () => patch((n) => n.budgets.splice(i, 1)),
            cells: [
              sel(b.cat, (e) => patch((n) => { n.budgets[i].cat = e.target.value; }), EXP_CATS, EXP_TINT[b.cat]),
              numc(b.planned, (e) => patch((n) => { n.budgets[i].planned = num(e.target.value); })),
              plain(mon(actual), { align: "right" }),
              plain((diff > 0 ? "+" : "") + mon(diff), { align: "right", tint: diff > 0 ? "home" : "", tinted: diff > 0, muted: diff <= 0 }),
              barc(used, Math.round(used) + "%", diff > 0 ? "home" : (EXP_TINT[b.cat] || "health")),
            ],
          };
        }),
        add: () => patch((n) => n.budgets.push({ cat: "Groceries", planned: 0 })),
        addLabel: "+ New budget line",
      }),
    ],
  };

  // ===== Net Worth
  // Merges what used to be three separate tabs (Debt Payoff, Savings,
  // Investments) — each is one facet of the same "where do I stand
  // overall" question, and each was a single table plus its own KPI row
  // repeating the same "total/target/progress" shape three times.
  const savedTotal = d.savings.reduce((s, x) => s + num(x.saved), 0);
  const targetTotal = d.savings.reduce((s, x) => s + num(x.target), 0);
  const savingsMonthly = d.savings.reduce((s, x) => s + num(x.monthly), 0);
  const withInvest = (fn) => patch((n) => { if (!n.investments) n.investments = []; fn(n); });
  const netPosition = savedTotal + investCurrentTotal - owed;
  P.networth = {
    title: "Net Worth", role: "Debts, savings, investments", roleTint: "money",
    sub: "Everything you owe against everything you've put aside or invested — three sections, one page, since they're all one picture.",
    kpis: [
      { label: "Net position", value: mon(netPosition), note: "saved + invested − owed", tint: netPosition >= 0 ? "health" : "home", explain: "Total saved plus invested, minus everything you owe, across all three sections below." },
      { label: "Total owed", value: mon(owed), note: d.debts.length + " debts", tint: owed ? "money" : "", explain: "Sum of every debt's current balance, from Your debts below." },
      { label: "Debt paid off", value: mon(started - owed), note: "", hasBar: true, pct: started ? 100 * (started - owed) / started : 0, tint: "money", explain: "How much of your starting debt total you've paid down so far." },
      { label: "Total saved", value: mon(savedTotal), note: d.savings.length + " pots", explain: "Sum of every savings pot's current amount, from Savings pots below." },
      { label: "Invested", value: mon(investCurrentTotal), note: (investGain >= 0 ? "+" : "") + Math.round(investGainPct) + "% gain/loss", tint: investGain < 0 ? "home" : "health", explain: "Current value of every holding, from Investment holdings below." },
    ],
    blocks: [
      settingsBlock("Debt payoff strategy", "changes the order and every date below", [
        { label: "Payoff order", isSelect: true, v: d.strategy, options: ["Snowball", "Avalanche", "Custom"], set: (e) => patch((n) => { n.strategy = e.target.value; }) },
        { label: "Extra each month", isNum: true, v: String(d.extra), set: (e) => patch((n) => { n.extra = num(e.target.value); }) },
      ]),
      line("Total balance", sim.months ? sim.months + " months to clear, debt-free by " + fmtMon(edate(today, sim.months)) + ", " + mon(sim.interest) + " interest to come" : "raise the extra payment to project a debt-free date", sim.trace,
        sim.trace.length > 1 ? ["now", fmtMon(edate(today, Math.round(sim.months * 0.33))), fmtMon(edate(today, Math.round(sim.months * 0.66))), fmtMon(edate(today, sim.months))] : ["now"],
        (v) => mon(v)),
      table({
        title: "Your debts", note: d.strategy + " order",
        emptyLabel: "No debts logged", emptyNote: "Add one to start tracking your payoff plan.",
        grid: "50px 1.4fr 130px 100px 130px 90px 130px 140px 1fr",
        head: [{ t: "#", align: "left" }, "Debt", { t: "Balance", align: "right" }, { t: "APR %", align: "right" }, { t: "Minimum", align: "right" }, { t: "Months", align: "right" }, "Clear by", "Your deadline", "Paid off"],
        rows: sim.order.map((i, rank) => {
          const x = d.debts[i];
          const m = sim.cleared[i];
          const paid = num(x.start) ? 100 * (num(x.start) - num(x.balance)) / num(x.start) : 0;
          const clearTs = m ? edate(today, m) : null;
          const deadlineTs = x.deadline ? parseISO(x.deadline) : null;
          const onTrack = deadlineTs ? (clearTs ? clearTs <= deadlineTs : false) : null;
          return {
            remove: () => patch((n) => n.debts.splice(i, 1)),
            cells: [
              plain(String(rank + 1), { muted: true }),
              edit(x.name, (e) => patch((n) => { n.debts[i].name = txt(e); })),
              numc(x.balance, (e) => patch((n) => { n.debts[i].balance = num(e.target.value); })),
              numc(x.apr, (e) => patch((n) => { n.debts[i].apr = num(e.target.value); }), { step: "0.1", tint: num(x.apr) >= 20 ? "home" : "", tinted: num(x.apr) >= 20 }),
              numc(x.min, (e) => patch((n) => { n.debts[i].min = num(e.target.value); })),
              plain(m ? String(m) : "—", { align: "right", tint: m ? "" : "home", tinted: !m }),
              plain(m ? fmtMon(edate(today, m)) : "never at this rate", { muted: !!m, tint: onTrack === false ? "home" : "", tinted: onTrack === false }),
              datec(x.deadline || "", (e) => patch((n) => { n.debts[i].deadline = e.target.value; })),
              barc(paid, Math.round(paid) + "%", "money"),
            ],
          };
        }),
        add: () => patch((n) => n.debts.push({ name: "New debt", start: 1000, balance: 1000, apr: 20, min: 25, order: n.debts.length + 1, deadline: "" })),
        addLabel: "+ New debt",
      }),
      table({
        title: "Savings pots",
        note: (targetTotal ? Math.round(100 * savedTotal / targetTotal) + "% saved overall, " + mon(targetTotal - savedTotal) + " to go" : "")
          + (savingsMonthly ? " — " + mon(savingsMonthly) + "/mo total" : ""),
        emptyLabel: "No savings pots yet", emptyNote: "Add one for anything you're putting money aside for.",
        grid: "1.7fr 130px 130px 150px 120px 100px 1fr 110px",
        head: ["Goal", { t: "Target", align: "right" }, { t: "Saved", align: "right" }, "Target date", { t: "Monthly", align: "right" }, { t: "Months", align: "right" }, "Progress", "On track?"],
        rows: d.savings.map((x, i) => {
          const gap = num(x.target) - num(x.saved);
          const months = num(x.monthly) > 0 ? Math.ceil(gap / num(x.monthly)) : null;
          const pct = num(x.target) ? Math.min(100, 100 * num(x.saved) / num(x.target)) : 0;
          const due = parseISO(x.date);
          const status = pct >= 100 ? "Done" : (months === null ? "Paused" : (due && edate(today, months) <= due ? "Yes" : "Behind"));
          return {
            remove: () => patch((n) => n.savings.splice(i, 1)),
            cells: [
              edit(x.name, (e) => patch((n) => { n.savings[i].name = txt(e); })),
              numc(x.target, (e) => patch((n) => { n.savings[i].target = num(e.target.value); })),
              numc(x.saved, (e) => patch((n) => { n.savings[i].saved = num(e.target.value); })),
              datec(x.date, (e) => patch((n) => { n.savings[i].date = e.target.value; })),
              numc(x.monthly, (e) => patch((n) => { n.savings[i].monthly = num(e.target.value); })),
              plain(months === null ? "—" : String(months), { align: "right", muted: true }),
              barc(pct, Math.round(pct) + "%", pct >= 100 ? "health" : "money"),
              chip(status, status === "Behind" ? "home" : (status === "Paused" ? "" : "health")),
            ],
          };
        }),
        add: () => patch((n) => n.savings.push({ name: "New pot", target: 500, saved: 0, date: iso(today + 180 * DAY), monthly: 25 })),
        addLabel: "+ New pot",
      }),
      table({
        title: "Investment holdings", note: investedTotal ? (investGain >= 0 ? "+" : "") + Math.round(investGainPct) + "% overall" : "",
        emptyLabel: "No investments logged yet", emptyNote: "Add one to start tracking its gain or loss over time.",
        grid: "1.7fr 140px 140px 140px 140px 1fr",
        head: ["Name", "Type", { t: "Invested", align: "right" }, { t: "Current value", align: "right" }, { t: "Gain / loss", align: "right" }, "Since"],
        rows: investments.map((x, i) => {
          const gain = num(x.current) - num(x.invested);
          const gainPct = num(x.invested) ? Math.round(100 * gain / num(x.invested)) : 0;
          return {
            remove: () => withInvest((n) => { n.investments.splice(i, 1); }),
            cells: [
              edit(x.name, (e) => withInvest((n) => { n.investments[i].name = txt(e); })),
              sel(x.type, (e) => withInvest((n) => { n.investments[i].type = e.target.value; }), INVEST_TYPES, "money"),
              numc(x.invested, (e) => withInvest((n) => { n.investments[i].invested = num(e.target.value); })),
              numc(x.current, (e) => withInvest((n) => { n.investments[i].current = num(e.target.value); })),
              plain(mon(gain) + " (" + (gain >= 0 ? "+" : "") + gainPct + "%)", { align: "right", tint: gain < 0 ? "home" : "health", tinted: true }),
              datec(x.date, (e) => withInvest((n) => { n.investments[i].date = e.target.value; })),
            ],
          };
        }),
        add: () => withInvest((n) => { n.investments.push({ name: "New holding", type: "Stocks", invested: 0, current: 0, date: iso(today) }); }),
        addLabel: "+ New holding",
      }),
    ],
  };

  // ===== Meal Plan
  const mealRows = ["Breakfast", "Lunch", "Dinner", "Snacks"];
  P.meals = {
    title: "Meal Plan", role: "Type freely", roleTint: "health",
    sub: "Fill the week, list the ingredients, and the shop at the bottom rolls the quantities up for you — repeat an ingredient and it adds together automatically.",
    kpis: [
      { label: "Still to buy", value: String(groceryTotal - gotCount), note: "", tint: "money", explain: "Items on The shop below not yet ticked Got." },
      { label: "In the trolley", value: String(gotCount), note: "", hasBar: true, pct: groceryTotal ? 100 * gotCount / groceryTotal : 0, tint: "health", explain: "Items on The shop below already ticked Got." },
    ],
    blocks: [
      settingsBlock("Your eating habits", "used to tailor this tab and, if you fast, to run the timer on Today", [
        { label: "Meals per day", isNum: true, v: String(d.settings.mealsPerDay ?? 3), set: setS("mealsPerDay", num) },
        { label: "Diet", isSelect: true, v: d.settings.diet || "No restrictions", options: DIETS, set: setS("diet") },
        {
          label: "Do you fast?", isSelect: true, v: d.settings.fasts || "No", options: ["No", "Yes"],
          hint: "Yes adds a live fasting countdown to the Today page",
          set: setS("fasts"),
        },
        ...(d.settings.fasts === "Yes" ? [
          { label: "Fast starts", isTime: true, v: d.settings.fastStart || "20:00", hint: "when your eating window closes", set: setS("fastStart") },
          { label: "Fast ends", isTime: true, v: d.settings.fastEnd || "12:00", hint: "when your eating window opens", set: setS("fastEnd") },
        ] : []),
      ]),
      table({
        title: "The week", note: "type anything — it saves as you go",
        grid: "120px repeat(7,1fr)",
        head: [""].concat(DAYNAMES),
        rows: mealRows.map((label, mi) => ({
          cells: [plain(label, { muted: true })].concat(
            DAYNAMES.map((_, di) => edit(d.meals[di + "-" + mi] || "", (e) => patch((n) => { n.meals[di + "-" + mi] = e.target.textContent; }))),
          ),
        })),
      }),
      table({
        title: "Ingredients", note: "this is what builds the shop",
        grid: "1.8fr 160px 110px 110px 1.4fr",
        head: ["Ingredient", "Aisle", { t: "Qty", align: "right" }, "Unit", "Used in"],
        rows: d.ingredients.map((g, i) => ({
          remove: () => patch((n) => n.ingredients.splice(i, 1)),
          cells: [
            edit(g.name, (e) => patch((n) => { n.ingredients[i].name = txt(e); })),
            sel(g.aisle, (e) => patch((n) => { n.ingredients[i].aisle = e.target.value; }), AISLES, AISLE_TINT[g.aisle]),
            numc(g.qty, (e) => patch((n) => { n.ingredients[i].qty = num(e.target.value); })),
            edit(g.unit, (e) => patch((n) => { n.ingredients[i].unit = txt(e); })),
            edit(g.used, (e) => patch((n) => { n.ingredients[i].used = txt(e); })),
          ],
        })),
        add: () => patch((n) => n.ingredients.push({ name: "New ingredient", aisle: "Produce", qty: 1, unit: "ea", used: "" })),
        addLabel: "+ New ingredient",
      }),
      table({
        title: "The shop", note: "quantities rolled up, sorted by aisle",
        grid: "1.8fr 170px 120px 110px 70px",
        head: ["Item", "Aisle", { t: "Total qty", align: "right" }, "Unit", "Got"],
        rows: grocery.map((g) => {
          const k = g.name + "|" + g.unit;
          return {
            cells: [
              plain(g.name, { muted: !!d.got[k] }),
              chip(g.aisle, AISLE_TINT[g.aisle]),
              plain(String(Math.round(g.qty * 100) / 100), { align: "right" }),
              plain(g.unit, { muted: true }),
              tog(!!d.got[k], () => patch((n) => { n.got[k] = !n.got[k]; }), "health"),
            ],
          };
        }),
      }),
      table({
        title: "Extras", note: "not in the meal plan",
        grid: "1.8fr 170px 120px 110px 70px",
        head: ["Item", "Aisle", { t: "Qty", align: "right" }, "Unit", "Got"],
        rows: d.extras.map((x, i) => ({
          remove: () => patch((n) => n.extras.splice(i, 1)),
          cells: [
            edit(x.name, (e) => patch((n) => { n.extras[i].name = txt(e); })),
            sel(x.aisle, (e) => patch((n) => { n.extras[i].aisle = e.target.value; }), AISLES, AISLE_TINT[x.aisle]),
            numc(x.qty, (e) => patch((n) => { n.extras[i].qty = num(e.target.value); })),
            edit(x.unit, (e) => patch((n) => { n.extras[i].unit = txt(e); })),
            tog(x.got, () => patch((n) => { n.extras[i].got = !n.extras[i].got; }), "health"),
          ],
        })),
        add: () => patch((n) => n.extras.push({ name: "New item", aisle: "Household", qty: 1, unit: "ea", got: false })),
        addLabel: "+ New extra",
      }),
    ],
  };

  // ===== Fitness
  const volByWeek = [];
  for (let w = 7; w >= 0; w--) {
    const from = wkFrom - w * 7 * DAY;
    const v = d.workouts.filter((x) => { const t = parseISO(x.date); return t !== null && t >= from && t < from + 7 * DAY; })
      .reduce((s, x) => s + num(x.sets) * num(x.reps) * num(x.weight), 0);
    volByWeek.push({ label: w === 0 ? "now" : "−" + w + "w", n: v, value: v ? Math.round(v / 100) / 10 + "k" : "0", tint: w === 0 ? "accent" : "health" });
  }
  P.fitness = {
    title: "Fitness", role: "Type freely", roleTint: "health",
    sub: "A weekly split per person, then a set-by-set log. Volume is sets × reps × weight, calculated for you.",
    kpis: [
      { label: "Sessions", value: String(d.workouts.length), note: "all time", explain: "Every row logged in Workout log below, ever." },
      { label: "This week", value: String(workoutsWk.length), note: "", explain: "Workout log entries dated within the current week." },
      { label: "Total volume", value: Math.round(volume).toLocaleString(), note: "kg lifted", explain: "Sets × reps × weight, summed across every logged workout." },
      { label: "Rest days planned", value: String(Object.keys(d.split).filter((k) => d.split[k] === "Rest").length), note: "", explain: "Rest days across This week's split below, for everyone in the household." },
    ],
    blocks: [
      columns("Training volume", "kg lifted per week", volByWeek),
      table({
        title: "This week's split", note: "",
        grid: "120px repeat(7,1fr)",
        head: [""].concat(DAYNAMES),
        rows: ["Me", "Partner"].map((who, pi) => ({
          cells: [plain(who, { muted: true })].concat(
            DAYNAMES.map((_, di) => {
              const k = di + "-" + pi;
              const v = d.split[k] || "Rest";
              return sel(v, (e) => patch((n) => { n.split[k] = e.target.value; }), FOCUS, FOCUS_TINT[v]);
            }),
          ),
        })),
      }),
      table({
        title: "Workout log", note: "newest first",
        grid: "140px 110px 1.6fr 130px 80px 80px 110px 120px",
        head: ["Date", "Person", "Exercise", "Focus", { t: "Sets", align: "right" }, { t: "Reps", align: "right" }, { t: "Weight", align: "right" }, { t: "Volume", align: "right" }],
        rows: d.workouts.slice().sort((a, b) => (parseISO(b.date) || 0) - (parseISO(a.date) || 0)).slice(0, 10).map((w) => {
          const i = d.workouts.indexOf(w);
          const vol = num(w.sets) * num(w.reps) * num(w.weight);
          // "Partner"/"Kid 1"/"Kid 2" only show up as a dropdown choice once
          // they've actually been used on a workout — solo users never see
          // household-member options they don't need. Typing a new name via
          // "Custom…" (see Cell.jsx) makes it a real option from then on.
          const whoOptions = Array.from(new Set(["Me", ...d.workouts.map((x) => x.who).filter(Boolean)]));
          return {
            remove: () => patch((n) => n.workouts.splice(i, 1)),
            cells: [
              datec(w.date, (e) => patch((n) => { n.workouts[i].date = e.target.value; })),
              sel(w.who, (e) => patch((n) => { n.workouts[i].who = e.target.value; }), whoOptions),
              edit(w.ex, (e) => patch((n) => { n.workouts[i].ex = txt(e); })),
              sel(w.focus, (e) => patch((n) => { n.workouts[i].focus = e.target.value; }), FOCUS, FOCUS_TINT[w.focus]),
              numc(w.sets, (e) => patch((n) => { n.workouts[i].sets = num(e.target.value); })),
              numc(w.reps, (e) => patch((n) => { n.workouts[i].reps = num(e.target.value); })),
              numc(w.weight, (e) => patch((n) => { n.workouts[i].weight = num(e.target.value); }), { step: "0.5" }),
              plain(vol ? Math.round(vol).toLocaleString() : "—", { align: "right", muted: !vol }),
            ],
          };
        }),
        add: () => patch((n) => n.workouts.unshift({ date: iso(today), who: "Me", ex: "New exercise", focus: "Push", sets: 3, reps: 10, weight: 20 })),
        addLabel: "+ Log a set",
      }),
    ],
  };

  // ===== Weight
  const wSorted = d.weights.slice().sort((a, b) => (parseISO(a.date) || 0) - (parseISO(b.date) || 0));
  // Accounts saved before this existed have no `weightGoal` field at all —
  // lazy-init on the draft before mutating, same pattern as withInvest/
  // withCycle above.
  const withWeightGoal = (fn) => patch((n) => { if (!n.weightGoal) n.weightGoal = { target: 0, motivation: "" }; fn(n); });
  const weightGoal = d.weightGoal || { target: 0, motivation: "" };
  const weightUnit = d.settings.units === "Metric" ? "kg" : "lb";
  // A commonly used BMI band (18.5-24.9), converted to a weight range at
  // this height — kept as an opt-in aside inside the BMI note below, not a
  // headline KPI. Putting a population range right next to someone's own
  // number invites a "graded against a benchmark" reading, and BMI is a
  // poor individual measure to begin with (see the note block). The one
  // number worth surfacing prominently is a goal the person set themselves
  // — self-chosen goals sustain motivation far better than an external
  // population average ever does.
  const refLowWeight = d.settings.units === "Metric"
    ? 18.5 * Math.pow(num(d.settings.height) / 100, 2)
    : 18.5 * Math.pow(num(d.settings.height), 2) / 703;
  const refHighWeight = d.settings.units === "Metric"
    ? 24.9 * Math.pow(num(d.settings.height) / 100, 2)
    : 24.9 * Math.pow(num(d.settings.height), 2) / 703;
  const toGoal = weightGoal.target > 0 && lastWeight ? num(lastWeight.kg) - num(weightGoal.target) : null;
  P.weight = {
    title: "Weight & BMI", role: "Type freely", roleTint: "health",
    sub: "BMI follows the units and height set on Overview. Log in any order — the chart sorts by date.",
    // Every card keeps the same label in every render, whatever the data
    // says — only the value/note/tint change. Swapping a card's whole
    // identity (e.g. "Entries" <-> "Toward your goal") based on live state
    // made the row visibly jump every time the goal field passed through
    // an empty/zero value mid-keystroke while typing a new number.
    kpis: [
      { label: "Latest", value: lastWeight ? num(lastWeight.kg) + (d.settings.units === "Metric" ? " kg" : " lb") : "—", note: lastWeight ? fmtDate(parseISO(lastWeight.date)) : "", explain: "Your most recent entry from the Log below." },
      { label: "BMI", value: bmi ? (Math.round(bmi * 10) / 10).toFixed(1) : "—", note: "at " + d.settings.height + (d.settings.units === "Metric" ? " cm" : " in"), explain: "Calculated from your latest weight and the height set on Overview." },
      {
        label: "Change", note: "since your first entry",
        // No color-coding here on purpose — tinting a drop green (and by
        // implication a rise as "bad") assumes weight loss is everyone's
        // goal, which isn't true for someone building muscle or working
        // toward a higher target. Same neutral color either direction.
        value: wSorted.length > 1 ? (num(wSorted[wSorted.length - 1].kg) - num(wSorted[0].kg)).toFixed(1) + " " + weightUnit : "—",
        explain: "Latest entry minus your very first logged entry.",
      },
      // Distance is framed the same way whichever direction it runs — no
      // "to lose"/"to gain" — and reaching it gets an actual celebratory
      // note instead of just going quiet.
      toGoal === null
        ? { label: "Toward your goal", value: "—", note: "set one below, if you'd like", explain: "Set a goal weight below to track progress toward it." }
        : (toGoal === 0
          ? { label: "Toward your goal", value: "You're there", note: "nice work", tint: "health", explain: "You've reached the goal weight set below." }
          : { label: "Toward your goal", value: Math.abs(toGoal).toFixed(1) + " " + weightUnit, note: "away, at your own pace", tint: "health", explain: "Difference between your latest entry and the goal weight set below." }),
    ],
    blocks: [
      settingsBlock("Your goal", "entirely optional — only set this if a target feels motivating to you", [
        { label: "Goal weight (" + weightUnit + ")", isNum: true, v: String(weightGoal.target || 0), set: (e) => withWeightGoal((n) => { n.weightGoal.target = num(e.target.value); }) },
        {
          label: "Motivation", isText: true, v: weightGoal.motivation || "",
          hint: "your own reason why — a reminder for days motivation dips",
          set: (e) => withWeightGoal((n) => { n.weightGoal.motivation = e.target.value; }),
        },
      ]),
      line("Weight", "every entry, in date order", wSorted.map((w) => num(w.kg)),
        // One real entry renders as two duplicated points (see line() in
        // engine.js), so its labels match that: the entry's own date and
        // "now", not the same date printed twice.
        wSorted.length === 0 ? ["—"]
          : wSorted.length === 1 ? [fmtMon(parseISO(wSorted[0].date)), "now"]
          : [fmtMon(parseISO(wSorted[0].date)), fmtMon(parseISO(wSorted[Math.floor(wSorted.length / 2)].date)), "now"],
        (v) => v.toFixed(1)),
      table({
        title: "Log", note: "",
        grid: "150px 120px 130px 110px 1.6fr",
        head: ["Date", "Person", { t: "Weight", align: "right" }, { t: "BMI", align: "right" }, "Notes"],
        rows: d.weights.slice().sort((a, b) => (parseISO(b.date) || 0) - (parseISO(a.date) || 0)).map((w) => {
          const i = d.weights.indexOf(w);
          const b = d.settings.units === "Metric" ? num(w.kg) / Math.pow(num(d.settings.height) / 100, 2) : 703 * num(w.kg) / Math.pow(num(d.settings.height), 2);
          return {
            remove: () => patch((n) => n.weights.splice(i, 1)),
            cells: [
              datec(w.date, (e) => patch((n) => { n.weights[i].date = e.target.value; })),
              sel(w.who, (e) => patch((n) => { n.weights[i].who = e.target.value; }), PEOPLE),
              numc(w.kg, (e) => patch((n) => { n.weights[i].kg = num(e.target.value); }), { step: "0.1" }),
              plain(isFinite(b) && b ? (Math.round(b * 10) / 10).toFixed(1) : "—", { align: "right", muted: true }),
              edit(w.note, (e) => patch((n) => { n.weights[i].note = txt(e); })),
            ],
          };
        }),
        add: () => patch((n) => n.weights.push({ date: iso(today), who: "Me", kg: lastWeight ? num(lastWeight.kg) : 75, note: "" })),
        addLabel: "+ New entry",
      }),
      notes("A note on BMI", "", [
        { t: "It is a population measure, not a verdict", s: "BMI is a rough screening number across large groups, not a health assessment of one person. Muscle, frame, and age all throw it off — it's one data point among many, not a score to chase." },
        { t: "Curious what a general reference looks like?", s: "A commonly cited BMI band (18.5–24.9) works out to roughly " + refLowWeight.toFixed(0) + "–" + refHighWeight.toFixed(0) + " " + weightUnit + " at your height. It's a population average, not a personal target — your own goal above is the one that actually matters." },
      ]),
    ],
  };

  // ===== Habits
  // Its own browsable month, independent of Monthly Calendar's — the old
  // design silently followed whatever month Monthly Calendar happened to
  // be on (a hidden settings field, then later its own nav), which meant
  // browsing one screen could quietly change what a completely different
  // screen showed. habitMonth is the same offset-from-real-today shape as
  // Monthly Calendar's own `month` and Weekly Planner's `week`.
  const habitAnchor = monthAnchorAt(state.habitMonth || 0);
  const hsHabit = habitStats(d, habitAnchor);
  const hlen = hsHabit.length ? hsHabit[0].len : 31;
  const habitAvgTab = hsHabit.length ? Math.round(hsHabit.reduce((s, x) => s + x.pct, 0) / hsHabit.length) : 0;
  const bestHabitTab = hsHabit.map((x, i) => ({ n: d.habits[i].name, s: x.streak })).sort((a, b) => b.s - a.s)[0];
  P.habits = {
    title: "Habit Tracker", role: "Click the squares", roleTint: "health",
    sub: "Streak counts back from today; the percentage is days done out of days elapsed.",
    kpis: [
      { label: "Habits", value: String(d.habits.length), note: "", explain: "Total habits tracked below." },
      { label: "Days counted", value: String(hsHabit.length ? hsHabit[0].counted : 0), note: "of " + hlen, explain: "Days elapsed so far in the month shown below, or the whole month if it's a past one." },
      { label: "Best streak", value: String(Math.max(...hsHabit.map((x) => x.best), 0)), note: bestHabitTab ? bestHabitTab.n : "", tint: "health", explain: "Longest run of consecutive done days this month, across every habit." },
      { label: "Month average", value: habitAvgTab + "%", note: "", hasBar: true, pct: habitAvgTab, tint: "health", explain: "Average completion rate across all habits this month." },
    ],
    blocks: [
      habitGridBlock(
        fmtMon(habitAnchor), "one square a day",
        Array.from({ length: hlen }, (_, i) => (i + 1) % 5 === 0 ? String(i + 1) : "·"),
        d.habits.map((h, hi) => ({
          name: h.name, streak: String(hsHabit[hi].streak), pct: hsHabit[hi].pct + "%",
          setName: (e) => patch((n) => { n.habits[hi].name = e.target.textContent; }),
          remove: () => patch((n) => n.habits.splice(hi, 1)),
          reminderTime: h.reminderTime || "",
          setReminder: (e) => patch((n) => { n.habits[hi].reminderTime = e.target.value; }),
          days: Array.from({ length: hlen }, (_, di) => ({
            on: !!h.days[di + 1], tint: h.tint,
            toggle: () => patch((n) => { const k = di + 1; if (n.habits[hi].days[k]) delete n.habits[hi].days[k]; else n.habits[hi].days[k] = true; }),
          })),
        })),
        () => patch((n) => n.habits.push({ name: "New habit", tint: "work", days: {}, reminderTime: "" })),
      ),
    ],
  };

  // ===== Account
  // Rendered by App.jsx's own <AccountSettings> component rather than the
  // generic Block system above (its sections — plan, connections, danger
  // zone — aren't shaped like a table/chart block), so this entry only
  // supplies the page header; kpis/blocks stay empty on purpose.
  P.account = {
    title: "Account", role: "Profile, plan, and connected apps", roleTint: "accent",
    sub: "Manage your sign-in, subscription, notifications, connected apps, and appearance.",
    kpis: [],
    blocks: [],
  };

  return P;
}

// The setup guide's checklist. Most steps detect themselves from real data
// (adding a real task, habit, bill/income entry replaces the sample row) —
// no separate "did they do this" flag to keep in sync, matching the rest
// of this file's pure-function-of-data shape. The two steps where a
// default value is itself a legitimate final answer (your name really can
// be "Me"; "no restrictions, 3 meals, no fasting" can really be correct)
// fall back to a manual checkbox stored in `onboarding.steps`, so those
// are never stuck unable to be marked done.
export function onboardingSteps(data, patch) {
  const d = data;
  const manual = (d.onboarding && d.onboarding.steps) || {};
  const withOnboarding = (fn) => patch((n) => {
    if (!n.onboarding) n.onboarding = { steps: {} };
    if (!n.onboarding.steps) n.onboarding.steps = {};
    fn(n);
  });
  const defs = [
    {
      id: "name", tab: "overview", label: "Add your name",
      note: "so the app can greet you properly",
      derived: !!(d.settings.name && d.settings.name.trim() && d.settings.name !== "Me"),
    },
    {
      id: "meals", tab: "meals", label: "Tell us about your eating habits",
      note: "meals a day, diet, and whether you fast — takes 10 seconds",
      derived: d.settings.diet !== "No restrictions" || num(d.settings.mealsPerDay) !== 3 || d.settings.fasts === "Yes",
    },
    {
      id: "task", tab: "tasks", label: "Add something you need to do",
      note: "a real task, not the sample one",
      derived: d.tasks.some((t) => t.name !== "Renew passport"),
    },
    {
      id: "bill", tab: "bills", label: "Add a bill or income entry",
      note: "so Money reflects your real numbers",
      derived: d.bills.some((b) => b.name !== "Rent") || d.income.some((i) => i.source !== "Monthly salary"),
    },
    {
      id: "habit", tab: "habits", label: "Add a habit to build a streak on",
      note: "anything you'd like to track daily",
      derived: d.habits.some((h) => h.name !== "Take meds"),
    },
  ];
  return defs.map((s) => {
    const done = s.derived || !!manual[s.id];
    return {
      id: s.id, tab: s.tab, label: s.label, note: s.note, done,
      toggle: () => withOnboarding((n) => { n.onboarding.steps[s.id] = !done; }),
    };
  });
}

// A function rather than a static list — the "Cycle Tracker" tab only
// exists once Overview's Gender setting is "Female", so the nav (and the
// `ids` list App.jsx derives from it) has to be recomputed from `data`
// instead of being a fixed constant.
export function buildNavGroups(data) {
  const life = [["meals", "Meal Plan", ""], ["fitness", "Fitness", ""], ["weight", "Weight Tracker", ""], ["habits", "Habit Tracker", ""]];
  if (data?.settings?.gender === "Female") life.push(["cycle", "Cycle Tracker", ""]);
  return [
    ["Start", [["overview", "Overview", "setup"], ["dashboard", "Dashboard", "auto"], ["today", "Today", "auto"]]],
    ["Tasks", [["tasks", "Task Tracker", ""], ["calendar", "Monthly Calendar", "auto"], ["weekly", "Weekly Planner", ""]]],
    ["Money", [["spending", "Spending", ""], ["income", "Income", ""], ["bills", "Bills", ""], ["networth", "Net Worth", ""]]],
    ["Wellness", life],
  ];
}
