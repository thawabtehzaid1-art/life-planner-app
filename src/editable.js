// Live-saves a contentEditable field's exact current text on every
// keystroke (so nothing is lost if the tab closes mid-edit), then trims
// stray leading/trailing whitespace once, on blur, as a final cleanup.
// The trim happens to the DOM node directly *before* calling `set`, not
// after — mutating textContent post-hoc while the field still has focus
// would fight the caret; doing it on blur (focus already leaving) is safe.
export function trimOnBlur(set) {
  return (e) => {
    const trimmed = e.currentTarget.textContent.trim();
    if (trimmed !== e.currentTarget.textContent) e.currentTarget.textContent = trimmed;
    set(e);
  };
}
