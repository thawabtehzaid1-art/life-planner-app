import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { seed, seedHabits, iso } from "./data.js";
import { updateEngagement } from "./engine.js";
import { buildPages, buildNavGroups, onboardingSteps } from "./pages.js";
import Block from "./Block.jsx";
import { supabase } from "./supabaseClient.js";
import Auth from "./Auth.jsx";
import Paywall from "./Paywall.jsx";
import FocusTimer from "./FocusTimer.jsx";
import MicButton from "./MicButton.jsx";
import FastingTimer from "./FastingTimer.jsx";
import OnboardingGuide from "./OnboardingGuide.jsx";
import { useAutoHide } from "./useAutoHide.js";
import { useVersionCheck } from "./useVersionCheck.js";
import AIAssistant from "./AIAssistant.jsx";
import { usePushSubscription } from "./usePushSubscription.js";
import { useGoogleCalendar } from "./useGoogleCalendar.js";
import { useHealthToken } from "./useHealthToken.js";
import AccountSettings from "./AccountSettings.jsx";
import { NAV_ICONS, IconInfo } from "./icons.jsx";

const THEME_KEY = "life-planner-theme-v1";
// Display labels come from AccountSettings.jsx's t("account.appearance.themeName." + id)
// rather than a field here, since this module has no access to the i18n hook.
const THEMES = [{ id: "dark" }, { id: "light" }, { id: "warm" }];

// One tint per nav group so items are scannable by color, not just text —
// reuses the same category-tint system already used for chips/toggles
// throughout the app (see data.js's TINTS) rather than introducing a
// separate icon set.
const GROUP_TINT = { start: "accent", tasks: "work", money: "money", wellness: "health" };

// Precomputed once (not per-celebration) — a small fixed burst pattern is
// plenty convincing and avoids recalculating trig on every badge earned.
// Colors reuse the app's existing category hues (see data.js's TINTS) for
// a burst that matches the rest of the palette instead of introducing new
// colors just for this.
const CONFETTI_HUES = [335, 25, 165, 95, 225]; // matches the category-tint hues in index.css (335 = "work", moved off violet)
const CONFETTI_DOTS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const dist = 60 + (i % 3) * 24;
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist), hue: CONFETTI_HUES[i % CONFETTI_HUES.length] };
});

function loadInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (THEMES.some((t) => t.id === saved)) return saved;
  } catch { /* first run or private mode */ }
  return "dark";
}

const THEME_AUTO_KEY = "life-planner-theme-auto-v1";
function loadInitialThemeAuto() {
  try { return window.localStorage.getItem(THEME_AUTO_KEY) === "1"; } catch { return false; }
}
// Matches each theme's own circadian rationale (see index.css's theme
// token comment): sage for the long stretch of actual daylight, amber for
// the evening wind-down, terracotta once it's genuinely dark out. Boundary
// hours are approximate on purpose -- this runs on whatever the device
// clock says, not sunrise/sunset for the person's real location, so exact
// precision here wouldn't mean anything anyway.
function themeForTimeOfDay(now) {
  const h = now.getHours();
  if (h >= 6 && h < 17) return "light";
  if (h >= 17 && h < 21) return "warm";
  return "dark";
}

function isEntitled(subscription) {
  if (!subscription) return false;
  if (subscription.status === "active") return true;
  if (subscription.status === "trialing") {
    return new Date(subscription.trial_ends_at).getTime() > Date.now();
  }
  return false;
}

// ---------------------------------------------------------------------
// Gate: figures out session + subscription state, then renders Auth,
// Paywall, or the real app. Split out from PlannerApp so the planner
// itself only ever deals with "I have a signed-in, entitled user id" —
// same shape of responsibility it had with plain localStorage.
// ---------------------------------------------------------------------
export default function AppGate() {
  const { t } = useTranslation();
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [subscription, setSubscription] = useState(null);
  const [subLoading, setSubLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setSubscription(null); return; }
    let cancelled = false;
    setSubLoading(true);
    supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", session.user.id)
      .single()
      .then(({ data }) => { if (!cancelled) { setSubscription(data); setSubLoading(false); } });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const { updateAvailable, refresh } = useVersionCheck();

  let body = null;
  if (session === undefined) body = null; // brief initial check, avoid a flash of the login screen
  else if (!session) body = <Auth />;
  else if (subLoading || subscription === null) body = null;
  else if (!isEntitled(subscription)) {
    body = <Paywall subscription={subscription} onSignOut={() => supabase.auth.signOut()} />;
  } else {
    body = (
      <PlannerApp
        userId={session.user.id}
        userEmail={session.user.email}
        subscription={subscription}
        onSignOut={() => supabase.auth.signOut()}
      />
    );
  }

  return (
    <>
      {updateAvailable && (
        <div className="update-banner">
          <span>{t("app.updateAvailable")}</span>
          <button type="button" onClick={refresh}>{t("app.refresh")}</button>
        </div>
      )}
      {body}
    </>
  );
}

function PlannerApp({ userId, userEmail, subscription, onSignOut }) {
  // Aliased to `translate`, not `t` -- the sidebar's own nav-item map
  // callback below already uses `t` as its loop variable for "tab", and
  // that pattern repeats throughout this file; renaming every one of
  // those would be a much larger, riskier diff than aliasing the one new
  // import instead.
  const { t: translate, i18n: i18nInstance } = useTranslation();
  // Today, not Dashboard — the daily landing page once you're past the
  // one-time Overview-then-Dashboard intro a brand-new account gets (see
  // the data-loading effect below, which overrides this to "overview" for
  // first-ever loads).
  const [tab, setTab] = useState("today");
  const [query, setQuery] = useState("");
  const [week, setWeek] = useState(0);
  // Which month Monthly Calendar is browsing, as an offset from the real
  // current month — same shape as `week` above (session-only, resets to
  // "this month" on reload).
  const [month, setMonth] = useState(0);
  // Habit Tracker's own browsable month — deliberately separate from
  // `month` above (it used to silently follow Monthly Calendar's browse
  // state) so browsing one screen never changes what the other shows.
  const [habitMonth, setHabitMonth] = useState(0);
  const [dayView, setDayView] = useState(null); // ISO date string, or null for "today" — set by clicking a Monthly Calendar day
  const [data, setData] = useState(null); // null = still loading this user's data
  const [syncError, setSyncError] = useState(false);
  const [theme, setTheme] = useState(loadInitialTheme);
  // The manually-picked theme above is preserved even while auto mode is
  // on, so turning auto off falls back to whatever was actually chosen
  // rather than defaulting back to Dark. `effectiveTheme` below is the one
  // actually applied to the page.
  const [themeAuto, setThemeAuto] = useState(loadInitialThemeAuto);
  const [autoClock, setAutoClock] = useState(() => new Date());
  useEffect(() => {
    if (!themeAuto) return;
    // 5 minutes is frequent enough to catch a boundary crossing (6am,
    // 5pm, 9pm) within a session that's just sitting open, without
    // waking the tab up for something this coarse -- same reasoning
    // FastingTimer's own 30s tick uses for a similarly slow-moving value.
    const id = setInterval(() => setAutoClock(new Date()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [themeAuto]);
  const effectiveTheme = themeAuto ? themeForTimeOfDay(autoClock) : theme;
  // Which group's chevron is rotated open and shows its one-line
  // description — exactly one at a time, not independent toggles. No
  // longer gates whether a group's nav items are visible/clickable (every
  // item renders regardless, so reaching any page never needs an expand
  // click first); this just tracks "which section are you in" for that
  // description hint. Starts on "Start" (the default landing tab,
  // Dashboard, lives there) and re-syncs to whichever group contains the
  // current tab whenever it changes (search result click, welcome-card
  // "Overview" link, etc.).
  const [openGroup, setOpenGroup] = useState("start");
  const searchRef = useRef(null);

  const toggleGroup = useCallback((name) => {
    setOpenGroup((prev) => (prev === name ? null : name));
  }, []);

  // A single generic "what does this mean" reveal, shared by the page-info
  // toggle and every KPI card: tap to show a short explanation, tap again
  // (or wait ~4s) to hide it — the info stays available without sitting on
  // screen permanently competing for attention.
  const [revealed, setRevealed] = useState(null);
  const revealTimerRef = useRef(null);
  const toggleReveal = useCallback((key) => {
    clearTimeout(revealTimerRef.current);
    setRevealed((cur) => {
      if (cur === key) return null;
      revealTimerRef.current = setTimeout(() => setRevealed(null), 4000);
      return key;
    });
  }, []);

  // Jump-to-rows: a KPI (e.g. "Overdue") or a datelink cell (a recurring
  // task's "next due" -> its generated occurrences) can point at a set of
  // row ids elsewhere on the same page. Scrolls that block into view and
  // flashes the matching rows for 2s, same self-clearing-timer shape as
  // toggleReveal above.
  const [highlightIds, setHighlightIds] = useState(null);
  const highlightTimerRef = useRef(null);
  const triggerHighlight = useCallback((ids, blockId) => {
    clearTimeout(highlightTimerRef.current);
    setHighlightIds(new Set(ids));
    document.getElementById(blockId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    highlightTimerRef.current = setTimeout(() => setHighlightIds(null), 2000);
  }, []);

  useEffect(() => {
    const found = buildNavGroups(data).find(([, items]) => items.some(([id]) => id === tab));
    if (found) setOpenGroup(found[0]);
  }, [tab, data]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA" && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);
  useEffect(() => {
    try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  useEffect(() => {
    try { window.localStorage.setItem(THEME_AUTO_KEY, themeAuto ? "1" : "0"); } catch { /* private mode */ }
  }, [themeAuto]);

  // On the stacked mobile layout the sidebar (with every nav item, the
  // theme switcher, etc.) sits above the page content, so scrolling to
  // page-top still shows the sidebar, not the tab you just tapped. Jump
  // to the content column's actual position instead — a no-op on desktop
  // (already at 0), and on mobile it lands exactly on the page you picked.
  // Deliberately not scrollIntoView(): with this many sticky-positioned
  // table cells on the page (the mobile sticky first column), it
  // undershoots the target by a couple hundred px in testing — a direct
  // offsetTop-based scroll doesn't have that problem.
  const mainColRef = useRef(null);
  useEffect(() => {
    const el = mainColRef.current;
    if (!el) return;
    window.scrollTo({ top: el.offsetTop, behavior: "instant" }); // desktop: whole page scrolls
    el.scrollTop = 0; // mobile: main-col scrolls internally instead (see index.css)
  }, [tab, dayView]);

  // Mobile only (see index.css): the sidebar is an off-canvas drawer,
  // closed by default and opened via the floating handle button below.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showTabsBtn = useAutoHide(1800);
  const push = usePushSubscription(userId);
  const gcal = useGoogleCalendar(userId);
  const health = useHealthToken(userId);
  // gcal.sync gets a new identity whenever gcal.connected changes (its own
  // useCallback depends on it) -- without this ref, that identity change
  // would cascade through flush -> patch -> the pages useMemo, forcing a
  // full recompute of every tab's derived data (not just a re-render) the
  // moment the Google Calendar status check resolves, unrelated to
  // anything the user did. Reading the latest sync through a ref instead
  // keeps flush/patch stable across that unrelated state change.
  const gcalSyncRef = useRef(gcal.sync);
  useEffect(() => { gcalSyncRef.current = gcal.sync; });

  // Load this user's row once on mount. A brand-new account's row is the
  // empty `{}` the signup trigger inserted — seed it with sample data the
  // first time so the app isn't blank on day one.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("planner_data")
      .select("data")
      .eq("user_id", userId)
      .single()
      .then(async ({ data: row }) => {
        if (cancelled) return;
        const isEmpty = !row?.data || Object.keys(row.data).length === 0;
        const loaded = isEmpty ? seedHabits(seed()) : row.data;
        // Records "opened the app today" for the login-streak badge — a
        // once-a-day update, not tied to editing anything, since just
        // showing up should count. Writes back only when it actually
        // changes anything (updateEngagement returns the same reference
        // untouched if today's already recorded).
        const withEngagement = updateEngagement(loaded, iso(Date.now()));
        // Backfills the device's timezone for accounts that predate this
        // field — read from the browser, not typed in, so reminder times
        // fire at the actual local hour instead of the server's UTC clock.
        let withTimezone = withEngagement;
        if (!withTimezone.settings?.timezone) {
          let tz = "UTC";
          try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* keep UTC */ }
          withTimezone = { ...withEngagement, settings: { ...withEngagement.settings, timezone: tz } };
        }
        setData(withTimezone);
        // Brand-new accounts land on Overview first (set your name/basics
        // before anything else); the `tab` state's own default ("today")
        // covers every other case — a returning account on any other day.
        if (withTimezone.onboarded === false) setTab("overview");
        if (isEmpty || withEngagement !== loaded || withTimezone !== withEngagement) {
          await supabase.from("planner_data").upsert({ user_id: userId, data: withTimezone, updated_at: new Date().toISOString() });
        }
      });
    return () => { cancelled = true; };
  }, [userId]);

  // The network write is debounced (typing shouldn't fire a request per
  // keystroke) but always flushed immediately if the tab is closed or
  // hidden, so nothing typed is ever lost between debounce ticks.
  const flush = useCallback(async () => {
    if (pendingRef.current === null) return;
    const toSave = pendingRef.current;
    pendingRef.current = null;
    const { error } = await supabase
      .from("planner_data")
      .upsert({ user_id: userId, data: toSave, updated_at: new Date().toISOString() });
    setSyncError(!!error);
    // Same debounce as the save itself — runs at most once per save, not
    // once per keystroke. No-ops internally if Calendar isn't connected.
    gcalSyncRef.current(toSave.tasks, toSave.bills, toSave.settings.timezone);
  }, [userId]);

  // Sync only otherwise fires on the next save's debounce — without this,
  // connecting Calendar for the first time (or returning to it after
  // reconnecting) would silently do nothing until you happened to edit a
  // task or bill. Fires once per "just became connected" transition, not
  // on every render.
  const syncedOnConnectRef = useRef(false);
  useEffect(() => {
    if (gcal.connected && data && !syncedOnConnectRef.current) {
      syncedOnConnectRef.current = true;
      gcal.sync(data.tasks, data.bills, data.settings.timezone);
    }
    if (!gcal.connected) syncedOnConnectRef.current = false;
  }, [gcal.connected, data, gcal.sync]);

  useEffect(() => {
    const onHide = () => { flush(); };
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  const patch = useCallback((fn) => {
    setData((current) => {
      // structuredClone does one native deep-copy pass; JSON.stringify +
      // JSON.parse did two full string round-trips of the entire data
      // blob (every task, expense, habit-day, weight entry...) on every
      // single keystroke anywhere in the app -- real, measurable lag on
      // an account with a few years of accumulated data.
      const next = structuredClone(current);
      fn(next);
      pendingRef.current = next;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 600);
      return next;
    });
  }, [flush]);

  const catchUp = useCallback((ri, oi) => {
    patch((n) => { for (let i = 0; i <= oi; i++) n.done[ri + ":" + i] = true; });
  }, [patch]);

  const onFocusSessionComplete = useCallback(() => {
    const todayISO = iso(Date.now());
    patch((n) => {
      if (!n.focusSessions) n.focusSessions = {};
      n.focusSessions[todayISO] = (n.focusSessions[todayISO] || 0) + 1;
    });
  }, [patch]);

  // Appends a dictated phrase to the current journal entry rather than
  // replacing it — speech recognition fires once per finished phrase, not
  // once for the whole session.
  const appendJournalText = useCallback((text) => {
    if (!text) return;
    const key = dayView || iso(Date.now());
    patch((n) => {
      if (!n.journal) n.journal = {};
      const current = n.journal[key] || "";
      const needsSpace = current && !/[\s\n]$/.test(current);
      n.journal[key] = current + (needsSpace ? " " : "") + text;
    });
  }, [patch, dayView]);

  const reset = useCallback(() => {
    const fresh = seedHabits(seed());
    setData(fresh);
    clearTimeout(timerRef.current);
    pendingRef.current = null;
    supabase.from("planner_data").upsert({ user_id: userId, data: fresh, updated_at: new Date().toISOString() }).then(({ error }) => setSyncError(!!error));
  }, [userId]);

  const goToDay = useCallback((dateISO) => { setDayView(dateISO); setTab("today"); }, []);

  // buildPages() calls the standalone i18n singleton's t() (it's a plain
  // function, not a hook -- can't use useTranslation() inside it), so this
  // memo has no other way to know a language switch should invalidate it.
  // i18n.language is a plain string, which is exactly what useMemo needs
  // to actually notice the change.
  const pages = useMemo(
    () => (data ? buildPages(data, { week, dayView, month, habitMonth }, { patch, catchUp, setWeek, goToDay, triggerHighlight }) : null),
    [data, week, dayView, month, habitMonth, patch, catchUp, goToDay, triggerHighlight, i18nInstance.language],
  );

  // Badge-earned celebration: watches the count rather than which badge,
  // so it doesn't need to know the badge list shape — just that it grew
  // since the last render. Ref starts at null so loading an account that
  // already has badges earned doesn't fire a celebration on first paint.
  const prevBadgesRef = useRef(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const n = pages?.dashboard?.badgesEarned;
    if (n == null) return;
    const prev = prevBadgesRef.current;
    prevBadgesRef.current = n;
    if (prev !== null && n > prev) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 1300);
      return () => clearTimeout(t);
    }
  }, [pages]);

  // Same title text already shown as the page's own <h1> (below), just
  // mirrored into the tab title so each screen is distinguishable in the
  // browser tab / history instead of every tab reading "Align".
  useEffect(() => {
    const activePage = pages && (pages[tab] || pages.dashboard);
    if (!activePage) return;
    const label = activePage.greeting ? activePage.greeting.title : activePage.title;
    document.title = label ? `${label} · Align` : "Align";
  }, [pages, tab]);

  if (!pages) return null; // loading this user's data

  const page = pages[tab] || pages.dashboard;
  const todayISO = iso(Date.now());

  const q = query.trim().toLowerCase();
  const navGroups = buildNavGroups(data);
  const groups = navGroups.map(([groupId, items]) => {
    const name = translate("nav.group." + groupId);
    return {
      id: groupId,
      name,
      items: items
        .map(([id, badge]) => ({ id, label: translate("nav.tab." + id), badge, on: tab === id }))
        // Filters against the TRANSLATED label/group name, not the raw id
        // -- otherwise search would only ever match English text typed
        // into an Arabic UI, which defeats the point of translating it.
        .filter((it) => !q || it.label.toLowerCase().includes(q) || name.toLowerCase().includes(q)),
    };
  }).filter((g) => g.items.length);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const kpis = page.kpis || [];
  // Computed once here (not inline where OnboardingGuide used to call it)
  // so the persistent reminder strip below and the full checklist on
  // Overview both read the same list without deriving it twice.
  const obSteps = data.onboarded === false ? onboardingSteps(data, patch) : null;
  const obDone = obSteps ? obSteps.filter((s) => s.done).length : 0;

  return (
    <div className="app-shell">
      <div className="sidebar" data-open={sidebarOpen ? "1" : ""}>
        <div className="brand-block">
          <div className="brand-row">
            <div className="brand-dot" />
            <div className="brand-name">Align</div>
          </div>
          <div className="brand-sub">{translate("app.syncedToAccount")}</div>
        </div>

        {syncError && (
          <div className="storage-warning" data-c="home">
            {translate("app.syncErrorBanner")}
          </div>
        )}

        <div className="find-box">
          <span className="find-label">{translate("app.find")}</span>
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={translate("app.findPlaceholder")} />
          {!query && <span className="find-shortcut">/</span>}
        </div>

        <nav className="nav-groups" aria-label={translate("app.sections")}>
          {groups.map((g) => {
            // Collapsed state is ignored while searching — a match hiding
            // inside a collapsed group would make the search box feel
            // broken ("I typed the right thing and nothing showed up").
            const expanded = !!q || openGroup === g.id;
            const groupDesc = translate("nav.groupDesc." + g.id, { defaultValue: "" });
            return (
              <div key={g.id} className="nav-group">
                <div
                  className="nav-group-name"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleGroup(g.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") toggleGroup(g.id); }}
                >
                  <span>{g.name}</span>
                  <span className="nav-group-chevron" data-open={expanded ? "1" : ""}>▾</span>
                </div>
                {expanded && !q && groupDesc && (
                  <div className="nav-group-desc">{groupDesc}</div>
                )}
                {/* Every item is always reachable in one click — the
                    collapse/expand toggle above is now just a visual
                    "which section am I in" cue (and the description
                    hint), not a gate you have to clear before a page in
                    a currently-collapsed group becomes clickable. */}
                {g.items.map((t) => {
                  const NavIcon = NAV_ICONS[t.id];
                  return (
                    <div
                      key={t.id}
                      data-nav="1"
                      data-on={t.on ? "1" : ""}
                      tabIndex={0}
                      onClick={() => { setTab(t.id); setSidebarOpen(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") setTab(t.id); }}
                      className="nav-item"
                    >
                      <span className="nav-icon" data-c={GROUP_TINT[g.id]}>{NavIcon && <NavIcon />}</span>
                      <span>{t.label}</span>
                      {/* The word alone ("setup"/"auto") doesn't explain
                          itself to someone seeing it for the first time,
                          especially mid-onboarding -- a native title
                          tooltip is the lowest-risk fix (no new
                          dismissal-tracking state, just an attribute). */}
                      {t.badge && (
                        <span className="nav-badge" title={translate("nav.badgeTitle." + t.badge)}>{translate("nav.badge." + t.badge)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Kept out of the searchable/collapsible nav-groups above: account
            settings apply globally rather than belonging to one content
            area (Tasks, Money, Wellness…), so it's pinned to the sidebar
            footer instead — the same separation Linear/Notion/Stripe make
            between workspace content nav and account settings. */}
        <nav className="sidebar-footer" aria-label={translate("account.pageTitle")}>
          <div
            data-nav="1"
            data-on={tab === "account" ? "1" : ""}
            tabIndex={0}
            onClick={() => { setTab("account"); setSidebarOpen(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") setTab("account"); }}
            className="nav-item"
          >
            <span className="nav-icon" data-c="accent"><NAV_ICONS.account /></span>
            <span>{translate("account.pageTitle")}</span>
          </div>
        </nav>

      </div>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <main className="main-col" ref={mainColRef}>
        <div className="page-header">
          <div className="page-header-left">
            {/* Every tab uses the same header shape now: a title, an ⓘ
                toggle that reveals the fuller description on demand
                instead of it sitting on screen permanently, and a short
                italic line underneath — the day's quote on Dashboard/
                Today (which greet you by name), the page's one-line role
                everywhere else. */}
            <div className="page-title-row">
              <h1 className="page-title">{page.greeting ? page.greeting.title : page.title}</h1>
              <button type="button" className="info-toggle" onClick={() => toggleReveal("page-sub")} aria-label={translate("app.whatThisPageShows")}><IconInfo width="13" height="13" /></button>
              {tab === "today" && dayView && (
                <button className="btn-outline back-today-btn" onClick={() => setDayView(null)}>{translate("app.backToToday")}</button>
              )}
            </div>
            <div className="page-sub page-quote">{page.greeting ? page.greeting.quote : page.role}</div>
            {revealed === "page-sub" && <div className="page-sub page-info-reveal">{page.sub}</div>}
            {tab === "overview" && push.supported && (
              <div className="push-optin">
                {push.subscribed ? (
                  <span className="push-optin-on">🔔 {translate("account.notifications.onForDevice")}</span>
                ) : (
                  <button type="button" className="header-link-btn" onClick={push.subscribe} disabled={push.busy}>
                    {push.busy ? translate("account.notifications.turningOn") : "🔔 " + translate("app.turnOnRemindersFull")}
                  </button>
                )}
                {push.error && <span className="push-optin-error"> — {push.error}</span>}
              </div>
            )}
            {tab === "overview" && gcal.connected !== null && (
              <div className="push-optin">
                {gcal.connected ? (
                  <>
                    <span className="push-optin-on">📅 {translate("app.googleCalendarConnected")}</span>
                    <button type="button" className="header-link-btn" onClick={gcal.disconnect} disabled={gcal.busy}>
                      {gcal.busy ? translate("account.connected.disconnecting") : translate("account.connected.disconnect")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="header-link-btn" onClick={gcal.connect}>
                    📅 {translate("app.connectGoogleCalendar")}
                  </button>
                )}
                {gcal.error && <span className="push-optin-error"> — {gcal.error}</span>}
              </div>
            )}
          </div>
          <div className="page-header-right">
            <div>{today}</div>
          </div>
        </div>

        <div className="page-body" key={tab + (dayView || "")}>
          {/* The full checklist only ever rendered on tab === "overview" —
              every step's "Go" button sends you somewhere else (Meal Plan,
              Task Tracker, ...), so the moment you followed it, the
              tracker vanished with no trace it existed, breaking the
              Zeigarnik-effect pull a visible open loop relies on. This
              keeps a trace on every other tab while onboarding is
              incomplete, without duplicating the full card Overview
              already shows. */}
          {data.onboarded === false && tab !== "overview" && (
            <div className="onboarding-strip">
              <span>{translate("app.settingUpAccount", { done: obDone, total: obSteps.length })}</span>
              <button type="button" className="header-link-btn" onClick={() => setTab("overview")}>{translate("app.backToChecklist")}</button>
            </div>
          )}

          {tab === "today" && !dayView && (
            <FocusTimer
              sessionsToday={(data.focusSessions && data.focusSessions[todayISO]) || 0}
              onSessionComplete={onFocusSessionComplete}
            />
          )}

          {tab === "today" && !dayView && data.settings?.fasts === "Yes" && (
            <FastingTimer data={data} patch={patch} />
          )}

          {/* Strictly === false, not falsy — existing accounts predate this
              field and have `onboarded: undefined`, which must NOT show the
              card (they already know the app); only seed()'s explicit
              `false` for brand-new accounts should. Lives on Overview now
              (the actual first stop for a new account) instead of
              Dashboard. Steps auto-check themselves as real data shows up
              (see onboardingSteps() in pages.js) — jumping to a tab and
              adding something is itself "finishing" that step, nothing
              extra to submit. Dismissible any time via "Skip for now";
              finishing marks onboarding done and carries you to Dashboard,
              completing the intended first-run sequence (Overview, then
              Dashboard) before Today becomes home. */}
          {tab === "overview" && data.onboarded === false && (
            <OnboardingGuide
              steps={obSteps}
              onNavigate={setTab}
              onFinish={() => {
                patch((n) => { n.onboarded = true; });
                setTab("dashboard");
                // Same celebrate-burst already used for earning a badge —
                // finishing setup is arguably a bigger first win than any
                // one badge, so it gets the same acknowledgment instead of
                // silently landing on Dashboard with nothing marking the
                // moment the setup journey just ended.
                setCelebrate(true);
                setTimeout(() => setCelebrate(false), 1300);
              }}
            />
          )}
          {/* The one thing on this page styled to stand out (Von Restorff) —
              a single plain-language headline instead of the old separate
              "Due today" / "Overdue" cards you had to read and add up
              yourself. Muted tones even for the urgent case, not alarm-red,
              to stay in the calm/trustworthy register rather than nagging. */}
          {tab === "dashboard" && page.hero && (
            <div className="hero-card" data-c={page.hero.tone}>
              <div className="hero-title">{page.hero.title}</div>
              <div className="hero-sub">{page.hero.sub}</div>
            </div>
          )}

          {kpis.length > 0 && (
            <div className="kpi-row">
              {kpis.map((k, i) => {
                const key = "kpi-" + i;
                const tappable = !!(k.explain || k.jump);
                const activate = () => {
                  if (k.explain) toggleReveal(key);
                  if (k.jump) triggerHighlight(k.jump.ids, k.jump.blockId);
                };
                return (
                  <div
                    key={i}
                    className="kpi-card"
                    data-tappable={tappable ? "1" : ""}
                    // A plain div with only onClick was never reachable by
                    // keyboard at all (no tabIndex, no Enter/Space handler)
                    // -- same role/tabIndex/onKeyDown shape .cal-cell and
                    // .nav-item already use for the same reason. Only
                    // tappable cards join the tab order; a card with
                    // neither explain nor jump has nothing to activate.
                    role={tappable ? "button" : undefined}
                    tabIndex={tappable ? 0 : undefined}
                    onClick={tappable ? activate : undefined}
                    onKeyDown={tappable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } } : undefined}
                  >
                    <div className="kpi-label">{k.label}</div>
                    <div className="kpi-value" data-c={k.tint}>{k.value}</div>
                    <div className="kpi-note">{k.note}</div>
                    {k.hasBar && (
                      <div className="kpi-bar-track">
                        <div className="kpi-bar-fill" data-c={k.tint} style={{ width: Math.max(0, Math.min(100, Math.round(k.pct))) + "%" }} />
                      </div>
                    )}
                    {k.link && (
                      <button
                        type="button"
                        className="header-link-btn kpi-link"
                        onClick={(e) => { e.stopPropagation(); setTab(k.link.tab); }}
                      >
                        {k.link.label}
                      </button>
                    )}
                    {revealed === key && k.explain && <div className="kpi-explain">{k.explain}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "account" && (
            <AccountSettings
              userEmail={userEmail}
              subscription={subscription}
              theme={effectiveTheme}
              setTheme={(id) => { setThemeAuto(false); setTheme(id); }}
              themeAuto={themeAuto}
              setThemeAuto={setThemeAuto}
              THEMES={THEMES}
              push={push}
              gcal={gcal}
              health={health}
              onSignOut={onSignOut}
              onNavigate={(t) => setTab(t)}
              onboarded={data.onboarded}
              patch={patch}
              reset={reset}
            />
          )}

          {page.blocks.map((b, i) => <Block key={i} b={b} highlightIds={highlightIds} revealed={revealed} toggleReveal={toggleReveal} />)}

          {/* Trend/motivational stats, deliberately quiet and placed last
              (Progressive Disclosure + Serial Position Effect) — they
              matter less to "what do I do right now" than the hero and
              KPI row above, so they don't compete for the same glance. */}
          {tab === "dashboard" && page.progress && page.progress.length > 0 && (
            <div className="progress-row">
              {page.progress.map((p, i) => (
                <div key={i} className="progress-item">
                  <div className="progress-label">{p.label}</div>
                  <div className="progress-value-row">
                    <span className="progress-value">{p.value}</span>
                    {p.note && <span className="progress-note">{p.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "today" && (
            <div className="journal-card">
              <div className="journal-header">
                <div>
                  <div className="journal-title">{dayView ? translate("app.journalForThatDay") : translate("app.todaysJournal")}</div>
                  <div className="journal-sub">{translate("app.journalSub")}</div>
                </div>
                <MicButton onText={appendJournalText} />
              </div>
              <textarea
                className="journal-box"
                placeholder={translate("app.writeAnything")}
                value={(data.journal && data.journal[dayView || todayISO]) || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  const key = dayView || todayISO;
                  patch((n) => { if (!n.journal) n.journal = {}; n.journal[key] = val; });
                }}
              />
            </div>
          )}

          {tab === "weekly" && (
            <div className="week-nav">
              <button className="btn-outline" onClick={() => setWeek((w) => w - 1)}>{translate("app.previousWeek")}</button>
              <button className="btn-outline" onClick={() => setWeek(0)}>{translate("app.thisWeek")}</button>
              <button className="btn-outline" onClick={() => setWeek((w) => w + 1)}>{translate("app.nextWeek")}</button>
            </div>
          )}

          {tab === "calendar" && (
            <div className="week-nav">
              <button className="btn-outline" onClick={() => setMonth((m) => m - 1)}>{translate("app.previousMonth")}</button>
              <button className="btn-outline" disabled={month === 0} onClick={() => setMonth(0)}>{translate("app.thisMonth")}</button>
              <button className="btn-outline" onClick={() => setMonth((m) => m + 1)}>{translate("app.nextMonth")}</button>
            </div>
          )}

          {tab === "habits" && (
            <div className="week-nav">
              <button className="btn-outline" onClick={() => setHabitMonth((m) => m - 1)}>{translate("app.previousMonth")}</button>
              <button className="btn-outline" disabled={habitMonth === 0} onClick={() => setHabitMonth(0)}>{translate("app.thisMonth")}</button>
              <button className="btn-outline" onClick={() => setHabitMonth((m) => m + 1)}>{translate("app.nextMonth")}</button>
            </div>
          )}
        </div>
      </main>

      {/* Mobile only (see index.css) — the sidebar is hidden by default now
          (an off-canvas drawer, not stacked above the content), so this is
          the only way to reach it. Fades out after a moment of no touch/
          scroll activity (useAutoHide) and reappears the instant you touch
          the screen again, so it's out of the way while reading but never
          more than a tap away. */}
      <button
        type="button"
        className="mobile-tabs-btn"
        data-visible={showTabsBtn ? "1" : ""}
        onClick={() => setSidebarOpen((o) => !o)}
        aria-label={translate("app.openTabs")}
      >
        ☰ {translate("app.menu")}
      </button>

      <AIAssistant data={data} patch={patch} />
      {/* Quick Capture (QuickCapture.jsx / quickCapture.js) is intentionally
          not rendered right now -- the parsing/matching logic and UI are
          intact and tested, just not wired up. It shipped globally-visible
          with only two working commands (log weight, mark habit done), which
          tested as confusing: no signal on any tab about what it could
          actually do. Re-enable once there's a better activation trigger
          than an always-on floating button -- see the "voice wizard" idea
          discussed for that. */}

      {celebrate && (
        <div className="celebrate-burst" aria-hidden="true">
          {CONFETTI_DOTS.map((d, i) => (
            <span
              key={i}
              className="celebrate-dot"
              style={{ "--dx": d.dx + "px", "--dy": d.dy + "px", background: `oklch(var(--cat-l) var(--cat-c) ${d.hue})` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
