import { useRef, useEffect } from "react";
import { trimOnBlur } from "./editable.js";

// An uncontrolled contentEditable element: React never feeds a rendered
// value back into this element *while it has focus*. Naively rendering
// `{value}` as children (a controlled-feeling contentEditable) races real
// fast typing — the app recomputes its entire data model on every
// keystroke, and if that catch-up render lands mid-word, React sees the
// DOM's current text no longer matches the (now-stale) value it's about
// to render and overwrites it, snapping the caret to the wrong spot.
// Characters then land wherever the caret was reset to instead of where
// you actually typed them — visible as text coming out scrambled/
// reversed. `onInput` still fires and saves on every keystroke same as
// before; the DOM just stops being told what it should contain while the
// user is the one actively editing it, since it's already correct.
export default function EditableSpan({ value, onInput, className, tag = "span", tabIndex = 0 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.textContent !== value) {
      el.textContent = value;
    }
  }, [value]);

  const Tag = tag;
  return (
    <Tag
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      tabIndex={tabIndex}
      onInput={onInput}
      onBlur={trimOnBlur(onInput)}
    />
  );
}
