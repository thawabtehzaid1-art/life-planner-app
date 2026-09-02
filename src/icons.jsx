// Shared icon set — same geometry conventions as src/icons/delete.svg and
// Block.jsx's inline DeleteIcon (24x24 viewBox, stroke=currentColor,
// stroke-width=2, round caps/joins, fill=none, no SVGR plugin so every
// icon is plain inline JSX rather than an imported .svg file). Built for
// two places this app was missing real icon clarity: the sidebar nav
// (16 items previously told apart only by a colored dot + text label)
// and the page-info toggle (previously a bare "ⓘ" text glyph, which
// renders inconsistently across platform fonts).
//
// Deliberately NOT extended to category chips (task category, expense
// category, priority, etc.) — those already carry color-coded tints on
// solid text labels across half a dozen different taxonomies (CATS,
// EXP_CATS, AISLES, FOCUS, ...); adding icons there would mean either an
// inconsistent partial set or a large one covering categories that
// already read clearly as color + word. Left as text on purpose.
function Base({ children, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export function IconOverview(p) {
  return <Base {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Base>;
}
export function IconDashboard(p) {
  return <Base {...p}><line x1="4" y1="20" x2="4" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="20" y1="20" x2="20" y2="14" /></Base>;
}
export function IconToday(p) {
  return <Base {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /><circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" /></Base>;
}
export function IconTasks(p) {
  return <Base {...p}><rect x="3" y="4" width="4" height="4" rx="1" /><line x1="10" y1="6" x2="21" y2="6" /><rect x="3" y="11" width="4" height="4" rx="1" /><line x1="10" y1="13" x2="21" y2="13" /><rect x="3" y="18" width="4" height="4" rx="1" /><line x1="10" y1="20" x2="21" y2="20" /></Base>;
}
export function IconCalendar(p) {
  return <Base {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></Base>;
}
export function IconWeekly(p) {
  return <Base {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="9" x2="8" y2="21" /><line x1="13" y1="9" x2="13" y2="21" /><line x1="17" y1="9" x2="17" y2="21" /></Base>;
}
export function IconSpending(p) {
  return <Base {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></Base>;
}
export function IconIncome(p) {
  return <Base {...p}><polyline points="3 17 9 11 13 15 21 7" /><polyline points="14 7 21 7 21 14" /></Base>;
}
export function IconBills(p) {
  return <Base {...p}><path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></Base>;
}
export function IconNetWorth(p) {
  return <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 3v9l7.5 4.3" /></Base>;
}
export function IconMeals(p) {
  return <Base {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></Base>;
}
export function IconFitness(p) {
  return <Base {...p}><rect x="2" y="9" width="4" height="6" rx="1" /><rect x="18" y="9" width="4" height="6" rx="1" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="9" y1="10" x2="9" y2="14" /><line x1="15" y1="10" x2="15" y2="14" /></Base>;
}
export function IconWeight(p) {
  return <Base {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 7v5l3 2" /></Base>;
}
export function IconHabits(p) {
  return <Base {...p}><circle cx="12" cy="12" r="9" /><polyline points="8 12 11 15 16 9" /></Base>;
}
export function IconCycle(p) {
  return <Base {...p}><path d="M20 12.5A8.5 8.5 0 1 1 11.5 4a7 7 0 0 0 8.5 8.5Z" /></Base>;
}
export function IconAccount(p) {
  return <Base {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Base>;
}
export function IconInfo(p) {
  return <Base {...p}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.6" strokeWidth="2.6" /></Base>;
}

export const NAV_ICONS = {
  overview: IconOverview, dashboard: IconDashboard, today: IconToday,
  tasks: IconTasks, calendar: IconCalendar, weekly: IconWeekly,
  spending: IconSpending, income: IconIncome, bills: IconBills, networth: IconNetWorth,
  meals: IconMeals, fitness: IconFitness, weight: IconWeight, habits: IconHabits, cycle: IconCycle,
  account: IconAccount,
};
