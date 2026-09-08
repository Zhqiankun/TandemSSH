import i18n from "./i18n";
import type strings from "./ui-text.en.json";

// For legacy widget metadata, native attributes and event-time notifications.
// Resolve on access instead of storing a translation at module initialization.
export function translateUiText(source: keyof typeof strings): string {
  return i18n.t(source, {
    ns: "tandem-ui",
    keySeparator: false,
    nsSeparator: false,
    defaultValue: source,
  });
}
