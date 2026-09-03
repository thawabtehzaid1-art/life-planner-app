import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ar from "./locales/ar.json";

const LANG_KEY = "align_lang";
const RTL_LANGS = ["ar"];

export function loadInitialLang() {
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch { /* private mode */ }
  return "en";
}

export function isRTL(lng) {
  return RTL_LANGS.includes((lng || "").split("-")[0]);
}

// Applied here (module init) and again from a `languageChanged` listener
// rather than only from whatever component happens to call
// changeLanguage() -- dir/lang need to be correct on the very first paint
// (screen readers and the browser's own form/number widgets read
// document-level dir immediately), not just after React re-renders.
function applyDocumentDirection(lng) {
  document.documentElement.dir = isRTL(lng) ? "rtl" : "ltr";
  document.documentElement.lang = lng;
}

const initialLang = loadInitialLang();
applyDocumentDirection(initialLang);

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  applyDocumentDirection(lng);
  try { window.localStorage.setItem(LANG_KEY, lng); } catch { /* private mode */ }
});

export default i18n;
