import {
  DAY, CATS, CAT_TINT, PRIOS, PRIO_TINT, STATUSES, STATUS_TINT, RECUR, RECUR_MONTHS, RECUR_DAYS,
  PEOPLE, EXP_CATS, EXP_TINT, AISLES, AISLE_TINT, FOCUS, FOCUS_TINT, INCOME_TYPES, INVEST_TYPES, DIETS, HOURS,
  iso, parseISO, edate, fmtDate, fmtMon, num,
} from "./data.js";
import {
  plain, chip, edit, numc, datec, timec, sel, tog, barc, datelink, table, notes, phasesBlock, badges, columns, line, donut,
  settingsBlock, calendarBlock, weekBlock, habitGridBlock,
  todayTs, wkStart, monthAnchorAt, monthRange, inRange, weekBounds,
  occurrences, nextDue, lateOccurrences, simulateDebt, groceryRoll, habitStats, cycleStats, cyclePhases, gamificationStats, money,
} from "./engine.js";
import i18n from "./i18n.js";

// buildPages() is a plain function, not a component or hook -- it can't
// call useTranslation(). The standalone i18n singleton's own .t() works
// the same way outside React, and App.jsx's pages useMemo already has
// i18n.language in its dependency array so this recomputes on switch.
const t = i18n.t.bind(i18n);

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
  const label = h < 5 ? t("greeting.evening") : h < 12 ? t("greeting.morning") : h < 17 ? t("greeting.afternoon") : t("greeting.evening");
  const dayOfYear = Math.floor(todayTsValue / DAY);
  // GREETING_QUOTES itself is intentionally still English-only -- a full
  // 20+ line motivational-quote translation pass is its own separate,
  // not-yet-done piece of work, flagged rather than rushed.
  const quote = GREETING_QUOTES[dayOfYear % GREETING_QUOTES.length];
  // Compared as "MM-DD" (not full dates) on purpose — a birthday recurs
  // every year, so only the month and day should ever match, never the
  // birth year itself. Built from local date parts, not toISOString()
  // (which is UTC and can land on the wrong calendar day depending on the
  // timezone offset) — todayTsValue is already local midnight.
  const todayD = new Date(todayTsValue);
  const todayMD = String(todayD.getMonth() + 1).padStart(2, "0") + "-" + String(todayD.getDate()).padStart(2, "0");
  if (birthday && birthday.slice(5) === todayMD) {
    return { title: name ? t("greeting.birthdayWithName", { name }) : t("greeting.birthday"), quote: t("greeting.birthdayQuote") };
  }
  return { title: name ? t("greeting.withName", { label, name }) : label, quote };
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
  // Translated day-of-week abbreviations, same Mon-first order and index
  // shape as data.js's DAYNAMES (which stays English -- other modules
  // outside this file still import it directly, and it's also used purely
  // as a 7-item iteration count in a couple of spots below where the text
  // itself is discarded).
  const DAYNAMES_T = [t("day.mon"), t("day.tue"), t("day.wed"), t("day.thu"), t("day.fri"), t("day.sat"), t("day.sun")];
  // The month Monthly Calendar and Habit Tracker are both browsing —
  // hoisted here (rather than computed locally in each section) because
  // habitStats() below needs it before Monthly Calendar's own section runs.
  const anchor = monthAnchorAt(state.month || 0);

  // ===== Overview
  P.overview = {
    title: t("overview.title"), role: t("overview.role"), roleTint: "money",
    sub: t("overview.sub"),
    blocks: [
      settingsBlock(t("overview.setup.title"), t("overview.setup.note"), [
        { label: t("overview.setup.name"), isText: true, v: d.settings.name, set: setS("name"), group: t("overview.setup.groupAboutYou"), id: "setup-name-field" },
        {
          label: t("overview.setup.birthday"), isDate: true, v: d.settings.birthday || "",
          hint: t("overview.setup.birthdayHint"),
          set: setS("birthday"), group: t("overview.setup.groupAboutYou"),
        },
        { label: t("overview.setup.height"), isNum: true, v: String(d.settings.height), set: setS("height", num), group: t("overview.setup.groupAboutYou") },
        {
          label: t("overview.setup.gender"), isSelect: true, v: d.settings.gender || "Prefer not to say",
          hint: t("overview.setup.genderHint"),
          options: ["Prefer not to say", "Male", "Female", "Other"],
          set: (e) => patch((n) => { n.settings.gender = e.target.value === "Prefer not to say" ? "" : e.target.value; }),
          group: t("overview.setup.groupAboutYou"),
        },
        { label: t("overview.setup.weekStart"), isSelect: true, v: d.settings.weekStart, options: ["Monday", "Sunday"], set: setS("weekStart"), group: t("overview.setup.groupPreferences") },
        { label: t("overview.setup.currency"), isText: true, v: d.settings.currency, set: setS("currency"), maxLength: 3, group: t("overview.setup.groupPreferences") },
        { label: t("overview.setup.units"), isSelect: true, v: d.settings.units, options: ["Metric", "Imperial"], set: setS("units"), group: t("overview.setup.groupPreferences") },
        {
          label: t("overview.setup.timezone"), isText: true, v: d.settings.timezone || "UTC",
          hint: t("overview.setup.timezoneHint"),
          set: setS("timezone"), group: t("overview.setup.groupPreferences"),
        },
      ]),
      table({
        title: t("overview.goals.title"), note: t("overview.goals.note"),
        emptyLabel: t("overview.goals.emptyLabel"), emptyNote: t("overview.goals.emptyNote"),
        grid: "1.9fr 120px 150px 110px 110px 1fr 110px",
        head: [t("overview.goals.head.goal"), t("overview.goals.head.category"), t("overview.goals.head.targetDate"), { t: t("overview.goals.head.target"), align: "right" }, { t: t("overview.goals.head.current"), align: "right" }, t("overview.goals.head.progress"), t("overview.goals.head.status")],
        rows: d.goals.map((g, i) => {
          const pct = num(g.target) ? Math.min(100, 100 * num(g.current) / num(g.target)) : 0;
          const due = parseISO(g.date);
          const status = pct >= 100 ? "Done" : (!due ? "No date" : (due < today ? "Overdue" : "On track"));
          const statusLabel = { Done: t("overview.goals.status.done"), "No date": t("overview.goals.status.noDate"), Overdue: t("overview.goals.status.overdue"), "On track": t("overview.goals.status.onTrack") }[status];
          return {
            remove: () => patch((n) => n.goals.splice(i, 1)),
            cells: [
              edit(g.name, (e) => patch((n) => { n.goals[i].name = txt(e); })),
              sel(g.cat, (e) => patch((n) => { n.goals[i].cat = e.target.value; }), CATS, CAT_TINT[g.cat]),
              datec(g.date, (e) => patch((n) => { n.goals[i].date = e.target.value; })),
              numc(g.target, (e) => patch((n) => { n.goals[i].target = num(e.target.value); })),
              numc(g.current, (e) => patch((n) => { n.goals[i].current = num(e.target.value); })),
              barc(pct, Math.round(pct) + "%", pct >= 100 ? "health" : CAT_TINT[g.cat]),
              chip(statusLabel, status === "Overdue" ? "home" : (status === "Done" ? "health" : (status === "No date" ? "" : "health"))),
            ],
          };
        }),
        add: () => patch((n) => n.goals.push({ name: t("overview.goals.newGoal"), cat: "Personal", date: iso(today + 90 * DAY), target: 100, current: 0 })),
        addLabel: t("overview.goals.addLabel"),
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
    // Phrased around the count rather than declined with it ("Items
    // needing attention today: N") -- Arabic has six grammatical plural
    // forms (zero/one/two/few/many/other), not the two English gets away
    // with, and getting all six genuinely right for every dynamic count
    // string in this app is its own dedicated pass, not something to
    // improvise correctly on the fly. This phrasing is correct Arabic in
    // every case, just less colloquial than the English original.
    title: attentionCount === 0 ? t("dashboard.hero.caughtUp") : t("dashboard.hero.needsAttention", { count: attentionCount }),
    sub: attentionCount === 0 ? t("dashboard.hero.nothingDue") : attentionOverdue ? t("dashboard.hero.overdueRest", { count: attentionOverdue }) : t("dashboard.hero.allDueToday"),
    tone: attentionCount === 0 ? "health" : (attentionOverdue ? "home" : "money"),
  };
  P.dashboard = {
    title: t("dashboard.title"), role: t("dashboard.role"), roleTint: "people",
    sub: (ownName ? t("dashboard.welcomeBack", { name: ownName }) + " " : "") + t("dashboard.sub"),
    greeting: greetingFor(ownName, today, d.settings.birthday),
    hero,
    kpis: [
      { label: t("dashboard.kpi.tasksComplete"), value: pctDone + "%", note: t("dashboard.kpi.ofCount", { done: d.tasks.filter((t) => t.status === "Completed").length, total: liveTasks.length }), hasBar: true, pct: pctDone, explain: t("dashboard.kpi.tasksCompleteExplain") },
      { label: t("dashboard.kpi.habits"), value: habitAvg + "%", note: bestHabit ? bestHabit.n + " · " + t("dashboard.kpi.days", { count: bestHabit.s }) : "", tint: "health", hasBar: true, pct: habitAvg, explain: t("dashboard.kpi.habitsExplain") },
      { label: t("dashboard.kpi.goalProgress"), value: goalAvg + "%", note: t("dashboard.kpi.goalsCount", { count: d.goals.length }), tint: "work", hasBar: true, pct: goalAvg, explain: t("dashboard.kpi.goalProgressExplain") },
      {
        label: t("dashboard.kpi.leftToSpend"), value: mon(left), note: t("dashboard.kpi.inAmount", { amount: mon(incomeIn) }), tint: left < 0 ? "home" : "money",
        explain: t("dashboard.kpi.leftToSpendExplain"),
        link: left < 0 ? { label: t("dashboard.kpi.reviewSpending"), tab: "spending" } : null,
      },
    ],
    progress: [
      { label: t("dashboard.progress.investments"), value: mon(investCurrentTotal), note: investments.length ? (investGain >= 0 ? "+" : "") + mon(investGain) + " (" + Math.round(investGainPct) + "%)" : t("dashboard.progress.noHoldings") },
      { label: t("dashboard.progress.points"), value: String(gam.points), note: t("dashboard.progress.badgesOf", { earned: gam.badgesEarned, total: gam.badges.length }) },
      { label: t("dashboard.progress.dayStreak"), value: String(gam.loginStreak), note: gam.loginStreak ? t("dashboard.progress.daysInRow") : t("dashboard.progress.openAgainTomorrow") },
    ],
    blocks: [
      table({
        title: t("dashboard.dueTable.title"), note: t("dashboard.dueTable.note"),
        grid: "34px 2fr 120px 120px 130px 1fr",
        head: ["", t("dashboard.dueTable.head.task"), t("dashboard.dueTable.head.category"), t("dashboard.dueTable.head.priority"), t("dashboard.dueTable.head.source"), t("dashboard.dueTable.head.when")],
        rows: overdueTasks.concat(dueTodayTasks).map((task) => {
          const i = d.tasks.indexOf(task);
          const late = parseISO(task.due) < today;
          const daysLate = late ? Math.round((today - parseISO(task.due)) / DAY) : 0;
          return {
            cells: [
              tog(false, () => patch((n) => { n.tasks[i].status = "Completed"; }), "health"),
              plain(task.name, { tint: late ? "home" : "", tinted: late }),
              chip(task.cat, CAT_TINT[task.cat]),
              chip(task.prio, PRIO_TINT[task.prio]),
              plain(t("dashboard.dueTable.sourceTasks"), { muted: true }),
              plain(late ? t("dashboard.dueTable.daysLate", { count: daysLate }) : t("dashboard.dueTable.today"), { muted: !late, tint: late ? "home" : "" }),
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
              plain(t("dashboard.dueTable.sourceRecurring"), { muted: true }),
              plain(overdue ? t("dashboard.dueTable.daysLate", { count: daysLate }) : t("dashboard.dueTable.today"), { muted: !overdue, tint: overdue ? "home" : "" }),
            ],
          };
        })),
      }),
      donut(t("dashboard.donut.title"), t("dashboard.donut.note"), mon(out), t("dashboard.donut.out"), [
        { label: t("dashboard.donut.bills"), n: billsIn, value: mon(billsIn), tint: "money" },
        { label: t("dashboard.donut.everydayExpenses"), n: expIn, value: mon(expIn), tint: "work" },
        { label: t("dashboard.donut.leftOver"), n: Math.max(0, left), value: mon(left), tint: "health" },
      ]),
      columns(t("dashboard.columns.title"), t("dashboard.columns.note"), d.habits.map((h, i) => ({ label: h.name.split(" ")[0], n: hs[i].pct, value: hs[i].pct + "%", tint: h.tint }))),
      badges(t("dashboard.badges.title"), t("dashboard.badges.note"), gam.badges),
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
        plain(t("today.checklist.workout", { focus: splitFocusView })), chip(t("today.checklist.sourceFitness"), "work"), plain(t("today.checklist.sourceFitness"), { muted: true }),
      ],
    }] : [])
    .concat(openTasksView.map((task) => {
      const i = d.tasks.indexOf(task);
      return { cells: [tog(false, () => patch((n) => { n.tasks[i].status = "Completed"; }), "health"), plain(task.name), chip(task.cat, CAT_TINT[task.cat]), plain(t("today.checklist.sourceTask"), { muted: true })] };
    }))
    .concat(occViewOpen.map((o) => ({
      cells: [tog(false, () => catchUp(o.ri, o.oi), "health"), plain(o.task.name), chip(o.task.cat, CAT_TINT[o.task.cat]), plain(t("today.checklist.sourceRecurring"), { muted: true })],
    })))
    .concat(billsView.map((b) => {
      const i = d.bills.indexOf(b);
      return { cells: [tog(false, () => patch((n) => { n.bills[i].paid = true; }), "money"), plain(b.name), chip(b.cat, "money"), plain(t("today.checklist.sourceBill"), { muted: true })] };
    }))
    .concat(habitsView.map(({ h, hi }) => ({
      cells: [tog(false, () => patch((n) => { n.habits[hi].days[domView] = true; }), h.tint), plain(h.name), chip(t("today.checklist.sourceHabit"), h.tint), plain(t("today.checklist.sourceHabitTracker"), { muted: true })],
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
        plain(t("today.checklist.workout", { focus: splitFocusView }), { muted: true, strike: true }), chip(t("today.checklist.sourceFitness"), "work"), plain(t("today.checklist.sourceFitness"), { muted: true }),
      ],
    }] : [])
    .concat(doneTasksView.map((task) => {
      const i = d.tasks.indexOf(task);
      return { cells: [tog(true, () => patch((n) => { n.tasks[i].status = "Not Started"; }), "health"), plain(task.name, { muted: true, strike: true }), chip(task.cat, CAT_TINT[task.cat]), plain(t("today.checklist.sourceTask"), { muted: true })] };
    }))
    .concat(occViewDone.map((o) => ({
      cells: [tog(true, () => patch((n) => { delete n.done[o.ri + ":" + o.oi]; }), "health"), plain(o.task.name, { muted: true, strike: true }), chip(o.task.cat, CAT_TINT[o.task.cat]), plain(t("today.checklist.sourceRecurring"), { muted: true })],
    })))
    .concat(paidBillsView.map((b) => {
      const i = d.bills.indexOf(b);
      return { cells: [tog(true, () => patch((n) => { n.bills[i].paid = false; }), "money"), plain(b.name, { muted: true, strike: true }), chip(b.cat, "money"), plain(t("today.checklist.sourceBill"), { muted: true })] };
    }))
    .concat(habitsDoneView.map(({ h, hi }) => ({
      cells: [tog(true, () => patch((n) => { delete n.habits[hi].days[domView]; }), h.tint), plain(h.name, { muted: true, strike: true }), chip(t("today.checklist.sourceHabit"), h.tint), plain(t("today.checklist.sourceHabitTracker"), { muted: true })],
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
    title: isViewingToday ? t("today.title") : fmtDate(viewTs), role: isViewingToday ? t("today.roleToday") : t("today.roleDayDetail"), roleTint: "accent",
    sub: isViewingToday ? t("today.subToday") : t("today.subDayDetail"),
    greeting: isViewingToday ? greetingFor(ownName, today, d.settings.birthday) : null,
    kpis: [
      { label: t("today.kpi.stillOpen"), value: String(dayOpen), note: dayOpen ? t("today.kpi.left") : t("today.kpi.allClear"), tint: dayOpen ? "" : "health", explain: t("today.kpi.stillOpenExplain") },
      { label: t("today.kpi.focusSessions"), value: String(sessionsView), note: isViewingToday ? t("today.kpi.today") : t("today.kpi.thatDay"), tint: "work", explain: t("today.kpi.focusSessionsExplain") },
      { label: t("today.kpi.spent"), value: mon(daySpendTotal), note: t("today.kpi.logged", { count: daySpend.length }), tint: daySpendTotal ? "money" : "" , explain: t("today.kpi.spentExplain") },
      ...(healthSynced ? [
        {
          label: t("today.kpi.steps"), value: d.health?.steps?.[viewISO] != null ? String(d.health.steps[viewISO]) : "—",
          note: t("today.kpi.fromHealth"), explain: t("today.kpi.fromHealthExplain"),
        },
        {
          label: t("today.kpi.sleep"), value: d.health?.sleepHours?.[viewISO] != null ? d.health.sleepHours[viewISO] + "h" : "—",
          note: t("today.kpi.fromHealth"), explain: t("today.kpi.fromHealthExplain"),
        },
      ] : []),
    ],
    blocks: [
      donut(t("today.donut.title"), t("today.donut.note"), dayPct + "%", t("today.donut.doneOf", { done: dayDone, total: dayTotal }), [
        { label: t("today.donut.done"), n: dayDone, value: String(dayDone), tint: "health" },
        { label: t("today.donut.stillOpen"), n: dayOpen, value: String(dayOpen), tint: "" },
      ]),
      table({
        title: t("today.checklist.title"), note: dayOpen ? t("today.checklist.leftCount", { count: dayOpen }) : t("today.checklist.nothingLeft"),
        emptyLabel: t("today.checklist.emptyLabel"), emptyNote: isViewingToday ? t("today.checklist.emptyNoteToday") : t("today.checklist.emptyNoteDay"),
        grid: "34px 2fr 130px 140px",
        head: ["", t("today.checklist.head.item"), t("today.checklist.head.category"), t("today.checklist.head.source")],
        rows: dayRows,
      }),
      table({
        title: t("today.spending.title"), note: daySpend.length ? t("today.spending.soFar", { amount: mon(daySpendTotal) }) : t("today.spending.nothingLogged"),
        grid: "1.8fr 150px 120px",
        head: [t("today.spending.head.description"), t("today.spending.head.category"), { t: t("today.spending.head.amount"), align: "right" }],
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
        add: () => patch((n) => n.expenses.push({ date: viewISO, desc: t("today.spending.newExpense"), cat: "Groceries", how: "Debit card", amount: 0 })),
        addLabel: t("today.spending.addLabel"),
        voiceAdd: (text) => patch((n) => n.expenses.push({ date: viewISO, desc: text, cat: "Groceries", how: "Debit card", amount: 0 })),
      }),
      notes(isViewingToday ? t("today.meals.titleToday") : t("today.meals.titleDay"), DAYNAMES_T[(viewDateObj.getDay() + 6) % 7], [t("today.meals.breakfast"), t("today.meals.lunch"), t("today.meals.dinner"), t("today.meals.snacks")].map((label, mi) => {
        const di = (viewDateObj.getDay() + 6) % 7;
        return { t: label, s: d.meals[di + "-" + mi] || t("today.meals.notPlanned") };
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
    title: t("tasks.title"), role: t("tasks.role"), roleTint: "health",
    sub: t("tasks.sub"),
    kpis: [
      { label: t("tasks.kpi.total"), value: String(liveTasks.length), note: "", explain: t("tasks.kpi.totalExplain") },
      { label: t("tasks.kpi.pctComplete"), value: pctDone + "%", note: "", hasBar: true, pct: pctDone, explain: t("tasks.kpi.pctCompleteExplain") },
      {
        label: t("tasks.kpi.overdue"), value: String(overdueTasks.length), note: "", tint: overdueTasks.length ? "home" : "health",
        explain: overdueTasks.length ? t("tasks.kpi.tapToJump") : t("tasks.kpi.overdueNone"),
        jump: overdueTasks.length ? { blockId: "all-tasks", ids: overdueTasks.map((task) => "task-" + d.tasks.indexOf(task)) } : null,
      },
      {
        label: t("tasks.kpi.dueToday"), value: String(dueTodayTasks.length), note: "",
        explain: dueTodayTasks.length ? t("tasks.kpi.tapToJump") : t("tasks.kpi.dueTodayNone"),
        jump: dueTodayTasks.length ? { blockId: "all-tasks", ids: dueTodayTasks.map((task) => "task-" + d.tasks.indexOf(task)) } : null,
      },
      { label: t("tasks.kpi.next7"), value: String(next7.length), note: "", explain: t("tasks.kpi.next7Explain") },
      { label: t("tasks.kpi.recurring"), value: String(d.recurring.length), note: "", explain: t("tasks.kpi.recurringExplain") },
    ],
    blocks: [
      table({
        title: t("tasks.all.title"), note: t("tasks.all.note"),
        emptyLabel: t("tasks.all.emptyLabel"), emptyNote: t("tasks.all.emptyNote"),
        grid: "1.5fr 1.4fr 110px 110px 130px 100px 130px 100px 90px",
        head: [t("tasks.all.head.task"), t("tasks.all.head.description"), t("tasks.all.head.category"), t("tasks.all.head.priority"), t("tasks.all.head.status"), t("tasks.all.head.owner"), t("tasks.all.head.dueDate"), t("tasks.all.head.remindAt"), { t: t("tasks.all.head.daysLeft"), align: "right" }],
        rows: d.tasks.map((task, i) => {
          const due = parseISO(task.due);
          const closed = task.status === "Completed" || task.status === "Cancelled";
          const days = (due === null || closed) ? "—" : Math.round((due - today) / DAY);
          const late = !closed && due !== null && due < today;
          return {
            id: "task-" + i,
            remove: () => patch((n) => n.tasks.splice(i, 1)),
            cells: [
              edit(task.name, (e) => patch((n) => { n.tasks[i].name = txt(e); })),
              edit(task.desc, (e) => patch((n) => { n.tasks[i].desc = txt(e); })),
              sel(task.cat, (e) => patch((n) => { n.tasks[i].cat = e.target.value; }), CATS, CAT_TINT[task.cat]),
              sel(task.prio, (e) => patch((n) => { n.tasks[i].prio = e.target.value; }), PRIOS, PRIO_TINT[task.prio]),
              sel(task.status, (e) => patch((n) => { n.tasks[i].status = e.target.value; }), STATUSES, STATUS_TINT[task.status]),
              sel(task.who, (e) => patch((n) => { n.tasks[i].who = e.target.value; }), PEOPLE),
              datec(task.due, (e) => patch((n) => { n.tasks[i].due = e.target.value; })),
              timec(task.reminderTime || "", (e) => patch((n) => { n.tasks[i].reminderTime = e.target.value; })),
              plain(String(days), { align: "right", tint: late ? "home" : "", tinted: late, muted: closed }),
            ],
          };
        }),
        add: () => patch((n) => n.tasks.push({ id: crypto.randomUUID(), name: t("tasks.all.newTask"), desc: "", cat: "Personal", prio: "Medium", status: "Not Started", who: "Me", due: iso(today), est: "", reminderTime: "" })),
        addLabel: t("tasks.all.addLabel"),
        voiceAdd: (text) => patch((n) => n.tasks.push({ id: crypto.randomUUID(), name: text, desc: "", cat: "Personal", prio: "Medium", status: "Not Started", who: "Me", due: iso(today), est: "", reminderTime: "" })),
      }),
      table({
        title: t("tasks.repeating.title"), note: t("tasks.repeating.note"),
        emptyLabel: t("tasks.repeating.emptyLabel"), emptyNote: t("tasks.repeating.emptyNote"),
        grid: "1.6fr 110px 110px 100px 130px 150px 110px 130px 100px",
        head: [t("tasks.repeating.head.task"), t("tasks.repeating.head.category"), t("tasks.repeating.head.priority"), t("tasks.repeating.head.owner"), t("tasks.repeating.head.firstDue"), t("tasks.repeating.head.frequency"), { t: t("tasks.repeating.head.every"), align: "right" }, t("tasks.repeating.head.nextDue"), t("tasks.repeating.head.remindAt")],
        rows: d.recurring.map((r, i) => {
          const nd = nextDue(d, i);
          const every = RECUR_MONTHS[r.freq] ? t("tasks.repeating.everyMonths", { count: RECUR_MONTHS[r.freq] }) : t("tasks.repeating.everyDays", { count: RECUR_DAYS[r.freq] || 0 });
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
        add: () => patch((n) => n.recurring.push({ name: t("tasks.repeating.newTask"), cat: "Home", prio: "Medium", who: "Me", first: iso(today), freq: "Weekly", reminderTime: "" })),
        addLabel: t("tasks.repeating.addLabel"),
      }),
      table({
        title: t("tasks.schedule.title"), note: t("tasks.schedule.note"),
        grid: "34px 1.8fr 130px 150px 90px 130px 1fr",
        head: ["", t("tasks.schedule.head.task"), t("tasks.schedule.head.category"), t("tasks.schedule.head.dueDate"), { t: t("tasks.schedule.head.num"), align: "right" }, t("tasks.schedule.head.owner"), t("tasks.schedule.head.status")],
        rows: scheduleOccs.map((o) => ({
          id: "occ-" + o.ri + "-" + o.oi,
          cells: [
            tog(false, () => catchUp(o.ri, o.oi), "health"),
            plain(o.task.name),
            chip(o.task.cat, CAT_TINT[o.task.cat]),
            plain(fmtDate(o.at), { muted: o.at > today }),
            plain(String(o.oi + 1), { align: "right", muted: true }),
            plain(o.task.who, { muted: true }),
            chip(o.at < today ? t("tasks.schedule.missed") : (o.at === today ? t("tasks.schedule.dueToday") : t("tasks.schedule.upcoming")), o.at < today ? "home" : (o.at === today ? "money" : "")),
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
  const dayNames = DAYNAMES_T.slice(wkStart(d) === 0 ? 6 : 0).concat(wkStart(d) === 0 ? DAYNAMES_T.slice(0, 6) : []);
  P.calendar = {
    title: fmtMon(anchor), role: t("calendar.role"), roleTint: "money",
    sub: t("calendar.sub"),
    blocks: [
      calendarBlock(t("calendar.month.title"), t("calendar.month.note"), dayNames, days),
      notes(t("calendar.whatLands.title"), "", [
        { t: t("calendar.whatLands.tasks"), s: t("calendar.whatLands.tasksNote") },
        { t: t("calendar.whatLands.recurring"), s: t("calendar.whatLands.recurringNote") },
        { t: t("calendar.whatLands.bills"), s: t("calendar.whatLands.billsNote") },
        { t: t("calendar.whatLands.targets"), s: t("calendar.whatLands.targetsNote") },
      ]),
    ],
  };

  // ===== Weekly
  const wkCells = [];
  wkCells.push({ kind: "plain", v: "" });
  for (let i = 0; i < 7; i++) {
    const at = wkFrom + i * DAY;
    const dd = new Date(at);
    wkCells.push({ kind: "plain", v: DAYNAMES_T[(wkStart(d) + i) % 7] + " " + dd.getDate(), today: at === today });
  }
  const wkOcc = occurrences(d, wkFrom, wkFrom + 6 * DAY);
  wkCells.push({ kind: "plain", v: t("weekly.due"), muted: true });
  for (let i = 0; i < 7; i++) {
    const at = wkFrom + i * DAY;
    // Names, not just the count, so the due cell can show what's actually
    // due on tap instead of leaving you to go check Task Tracker to know
    // what to type into the grid below.
    const dueNames = openTasks.filter((task) => parseISO(task.due) === at).map((task) => task.name)
      .concat(wkOcc.filter((o) => o.at === at && !o.done).map((o) => o.task.name));
    wkCells.push({
      kind: "plain", v: dueNames.length ? t("weekly.dueCount", { count: dueNames.length }) : "", tint: dueNames.length ? "accent" : "", tinted: !!dueNames.length,
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
    title: t("weekly.title"), role: t("weekly.role"), roleTint: "money",
    sub: t("weekly.sub"),
    kpis: [
      { label: t("weekly.kpi.blocked"), value: String(blocked), note: t("weekly.kpi.of", { count: HOURS.length * 7 }), explain: t("weekly.kpi.blockedExplain") },
      { label: t("weekly.kpi.free"), value: String(HOURS.length * 7 - blocked), note: "", tint: "health", explain: t("weekly.kpi.freeExplain") },
      { label: t("weekly.kpi.dueThisWeek"), value: String(openTasks.filter((task) => { const x = parseISO(task.due); return x !== null && x >= wkFrom && x < wkFrom + 7 * DAY; }).length + wkOcc.filter((o) => !o.done).length), note: "", explain: t("weekly.kpi.dueThisWeekExplain") },
      { label: t("weekly.kpi.workouts"), value: String(workoutsWk.length), note: t("weekly.kpi.loggedThisWeek"), tint: "health", explain: t("weekly.kpi.workoutsExplain") },
    ],
    blocks: [
      weekBlock(fmtDate(wkFrom) + " – " + fmtDate(wkFrom + 6 * DAY), t("weekly.clickAndType"), wkCells),
    ],
    weekOffset: state.week,
    setWeek,
  };

  // ===== Income
  P.income = {
    title: t("income.title"), role: t("income.role"), roleTint: "health",
    sub: t("income.sub"),
    kpis: [
      { label: t("income.kpi.thisMonth"), value: mon(incomeIn), note: "", explain: t("income.kpi.thisMonthExplain") },
      { label: t("income.kpi.entries"), value: String(inRange(d.income, "date", mr.from, mr.to).length), note: "", explain: t("income.kpi.entriesExplain") },
      { label: t("income.kpi.allTime"), value: mon(d.income.reduce((s, x) => s + num(x.amount), 0)), note: t("income.kpi.entriesCount", { count: d.income.length }), explain: t("income.kpi.allTimeExplain") },
    ],
    blocks: [
      table({
        title: t("income.entries.title"), note: "",
        grid: "150px 1.8fr 150px 140px 1.4fr",
        head: [t("income.entries.head.date"), t("income.entries.head.source"), t("income.entries.head.type"), { t: t("income.entries.head.amount"), align: "right" }, t("income.entries.head.notes")],
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
        add: () => patch((n) => n.income.push({ date: iso(today), source: t("income.entries.newIncome"), type: "Paycheck", amount: 0, note: "" })),
        addLabel: t("income.entries.addLabel"),
      }),
    ],
  };

  // ===== Bills
  P.bills = {
    title: t("bills.title"), role: t("bills.role"), roleTint: "health",
    sub: t("bills.sub"),
    kpis: [
      { label: t("bills.kpi.budgeted"), value: mon(d.bills.reduce((s, b) => s + num(b.budget), 0)), note: t("bills.kpi.billsCount", { count: d.bills.length }), explain: t("bills.kpi.budgetedExplain") },
      { label: t("bills.kpi.actual"), value: mon(d.bills.reduce((s, b) => s + num(b.actual), 0)), note: "", explain: t("bills.kpi.actualExplain") },
      { label: t("bills.kpi.unpaid"), value: mon(unpaidBills.reduce((s, b) => s + num(b.budget), 0)), note: t("bills.kpi.billsCount", { count: unpaidBills.length }), tint: unpaidBills.length ? "money" : "health", explain: t("bills.kpi.unpaidExplain") },
      (() => {
        const overdueBills = unpaidBills.filter((b) => parseISO(b.due) !== null && parseISO(b.due) < today);
        return {
          label: t("bills.kpi.overdue"), value: String(overdueBills.length), note: "", tint: "home",
          explain: overdueBills.length ? t("bills.kpi.tapToJump") : t("bills.kpi.overdueNone"),
          jump: overdueBills.length ? { blockId: "commitments", ids: overdueBills.map((b) => "bill-" + d.bills.indexOf(b)) } : null,
        };
      })(),
    ],
    blocks: [
      table({
        title: t("bills.commitments.title"), note: "",
        grid: "1.5fr 120px 110px 130px 110px 110px 100px 70px",
        head: [t("bills.commitments.head.bill"), t("bills.commitments.head.category"), t("bills.commitments.head.frequency"), t("bills.commitments.head.dueDate"), { t: t("bills.commitments.head.budgeted"), align: "right" }, { t: t("bills.commitments.head.actual"), align: "right" }, t("bills.commitments.head.remindAt"), t("bills.commitments.head.paid")],
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
        add: () => patch((n) => n.bills.push({ id: crypto.randomUUID(), name: t("bills.commitments.newBill"), cat: "Utilities", freq: "Monthly", due: iso(today), budget: 0, actual: 0, paid: false, reminderTime: "" })),
        addLabel: t("bills.commitments.addLabel"),
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
  // Most-recent-first, same ordering convention as the weight log below.
  const fastLog = (d.fastingLog || []).slice().sort((a, b) => (parseISO(b.date) || 0) - (parseISO(a.date) || 0));
  const fastCompletedCount = fastLog.filter((f) => !f.endedEarly).length;
  const fastCompletionPct = fastLog.length ? Math.round(100 * fastCompletedCount / fastLog.length) : 0;
  let fastStreak = 0;
  for (const f of fastLog) { if (f.endedEarly) break; fastStreak++; }
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
      ...(d.settings.fasts === "Yes" && fastLog.length ? [
        notes("Fasting history", "", [
          {
            t: fastStreak > 0 ? fastStreak + "-fast streak, no early stops" : "No current streak",
            s: fastCompletedCount + " of " + fastLog.length + " logged fasts completed on schedule (" + fastCompletionPct + "%).",
          },
        ]),
        table({
          title: "Past fasts", note: "logged automatically when a fast completes, or when you stop one early",
          grid: "110px 130px 90px 120px",
          head: ["Date", "Scheduled window", "Ended", "Result"],
          rows: fastLog.map((f) => ({
            cells: [
              plain(fmtDate(parseISO(f.date))),
              plain(f.scheduledStart + "–" + f.scheduledEnd, { muted: true }),
              plain(f.endedAt ? new Date(f.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—", { muted: true }),
              chip(f.endedEarly ? "Ended early" : "Completed", f.endedEarly ? "home" : "health"),
            ],
          })),
        }),
      ] : []),
      table({
        title: "The week", note: "type anything — it saves as you go",
        grid: "120px repeat(7,1fr)",
        head: [""].concat(DAYNAMES_T),
        rows: mealRows.map((label, mi) => ({
          cells: [plain(label, { muted: true })].concat(
            DAYNAMES_T.map((_, di) => edit(d.meals[di + "-" + mi] || "", (e) => patch((n) => { n.meals[di + "-" + mi] = e.target.textContent; }))),
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
        head: [""].concat(DAYNAMES_T),
        rows: ["Me", "Partner"].map((who, pi) => ({
          cells: [plain(who, { muted: true })].concat(
            DAYNAMES_T.map((_, di) => {
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
// Returns [groupId, [[tabId, badge], ...]] -- ids only, not display text.
// App.jsx translates both via t("nav.group." + id) / t("nav.tab." + id) at
// render time, so this stays the single stable identity every other part
// of the sidebar (GROUP_TINT, GROUP_DESC, the openGroup expand/collapse
// state) keys off, regardless of which language is active.
export function buildNavGroups(data) {
  const life = [["meals", ""], ["fitness", ""], ["weight", ""], ["habits", ""]];
  if (data?.settings?.gender === "Female") life.push(["cycle", ""]);
  return [
    ["start", [["overview", "setup"], ["dashboard", "auto"], ["today", "auto"]]],
    ["tasks", [["tasks", ""], ["calendar", "auto"], ["weekly", ""]]],
    ["money", [["spending", ""], ["income", ""], ["bills", ""], ["networth", ""]]],
    ["wellness", life],
  ];
}
