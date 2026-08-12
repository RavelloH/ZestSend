import { useEffect } from "react";

const storedLocaleKey = "zestsend_locale";

function preferredLocale(): "en" | "zh" {
  const stored = window.localStorage.getItem(storedLocaleKey);
  if (stored === "en" || stored === "zh") return stored;

  return navigator.languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export default function LocaleRedirect() {
  useEffect(() => {
    window.location.replace(`/${preferredLocale()}`);
  }, []);

  return null;
}
