import { useTranslation } from "react-i18next";

// Locale-owned, presentation-only text for generic primitives and existing
// widgets. The hook keeps mounted text in sync with a language change.
export function LocalizedText({ id }: { id: string }) {
  const { t } = useTranslation();
  return <>{t(`tandem.labels.${id}`)}</>;
}
