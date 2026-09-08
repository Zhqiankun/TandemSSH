import i18n, { type BackendModule, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en.json";
import enUiText from "./ui-text.en.json";
import zhUiText from "./ui-text.zh-CN.json";
import zhTranslation from "../locales/translated/zh_CN.json";

export const DEFAULT_LANGUAGE = "zh-CN";
export const LANGUAGE_STORAGE_KEY = "tandemssh.language";

type LocaleModule = { default: ResourceKey };

const localeLoaders = {
  af: () => import("../locales/translated/af_ZA.json"),
  ar: () => import("../locales/translated/ar_SA.json"),
  bn: () => import("../locales/translated/bn_BD.json"),
  bg: () => import("../locales/translated/bg_BG.json"),
  ca: () => import("../locales/translated/ca_ES.json"),
  cs: () => import("../locales/translated/cs_CZ.json"),
  da: () => import("../locales/translated/da_DK.json"),
  de: () => import("../locales/translated/de_DE.json"),
  el: () => import("../locales/translated/el_GR.json"),
  "es-ES": () => import("../locales/translated/es_ES.json"),
  fi: () => import("../locales/translated/fi_FI.json"),
  fr: () => import("../locales/translated/fr_FR.json"),
  he: () => import("../locales/translated/he_IL.json"),
  hi: () => import("../locales/translated/hi_IN.json"),
  hu: () => import("../locales/translated/hu_HU.json"),
  id: () => import("../locales/translated/id_ID.json"),
  it: () => import("../locales/translated/it_IT.json"),
  ja: () => import("../locales/translated/ja_JP.json"),
  ko: () => import("../locales/translated/ko_KR.json"),
  nl: () => import("../locales/translated/nl_NL.json"),
  no: () => import("../locales/translated/no_NO.json"),
  pl: () => import("../locales/translated/pl_PL.json"),
  "pt-PT": () => import("../locales/translated/pt_PT.json"),
  "pt-BR": () => import("../locales/translated/pt_BR.json"),
  ro: () => import("../locales/translated/ro_RO.json"),
  ru: () => import("../locales/translated/ru_RU.json"),
  sr: () => import("../locales/translated/sr_SP.json"),
  "sv-SE": () => import("../locales/translated/sv_SE.json"),
  th: () => import("../locales/translated/th_TH.json"),
  tr: () => import("../locales/translated/tr_TR.json"),
  uk: () => import("../locales/translated/uk_UA.json"),
  vi: () => import("../locales/translated/vi_VN.json"),
  "zh-TW": () => import("../locales/translated/zh_TW.json"),
} satisfies Record<string, () => Promise<LocaleModule>>;

export const supportedLngs = [
  DEFAULT_LANGUAGE,
  "en",
  ...Object.keys(localeLoaders),
];
const PENDING_LOGIN_LANGUAGE_KEY = "termix-pending-login-language";

export function normalizeLanguageCode(language?: string | null): string {
  if (typeof language !== "string" || !language.trim()) return DEFAULT_LANGUAGE;

  const normalized = language.trim().replaceAll("_", "-");
  if (supportedLngs.includes(normalized)) return normalized;

  const exactMatch = supportedLngs.find(
    (supported) => supported.toLowerCase() === normalized.toLowerCase(),
  );
  if (exactMatch) return exactMatch;

  const baseLanguage = normalized.split("-")[0].toLowerCase();
  if (baseLanguage.toLowerCase() === "zh") {
    return /^zh-(tw|hk|mo|hant)/i.test(normalized) ? "zh-TW" : DEFAULT_LANGUAGE;
  }
  return supportedLngs.includes(baseLanguage) ? baseLanguage : DEFAULT_LANGUAGE;
}

const localeBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language, namespace, callback) => {
    if (namespace === "tandem-ui") {
      callback(
        null,
        normalizeLanguageCode(language) === "en" ? enUiText : zhUiText,
      );
      return;
    }
    const normalizedLanguage = normalizeLanguageCode(language);

    if (normalizedLanguage === DEFAULT_LANGUAGE) {
      callback(null, zhTranslation);
      return;
    }

    if (normalizedLanguage === "en") {
      callback(null, enTranslation);
      return;
    }

    const loadLocale = localeLoaders[normalizedLanguage];
    if (!loadLocale) {
      callback(null, zhTranslation);
      return;
    }

    loadLocale()
      .then((module) => callback(null, module.default))
      .catch(() => callback(null, zhTranslation));
  },
};

i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs,
    fallbackLng: DEFAULT_LANGUAGE,
    initAsync: false,
    debug: false,

    detection: {
      order: ["localStorage", "cookie"],
      caches: ["localStorage", "cookie"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      lookupCookie: LANGUAGE_STORAGE_KEY,
    },

    resources: {
      "zh-CN": { translation: zhTranslation, "tandem-ui": zhUiText },
      en: {
        translation: enTranslation,
        "tandem-ui": enUiText,
      },
    },
    partialBundledLanguages: true,

    interpolation: {
      escapeValue: false,
    },

    react: {
      useSuspense: false,
    },
  });

export async function changeAppLanguage(language: string): Promise<string> {
  const normalizedLanguage = normalizeLanguageCode(language);
  await i18n.changeLanguage(normalizedLanguage);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguage);
  localStorage.setItem("i18nextLng", normalizedLanguage);
  return normalizedLanguage;
}

export function rememberLoginLanguage(language: string): string {
  const normalizedLanguage = normalizeLanguageCode(language);
  sessionStorage.setItem(PENDING_LOGIN_LANGUAGE_KEY, normalizedLanguage);
  return normalizedLanguage;
}

export function consumeLoginLanguage(): string | null {
  const language = sessionStorage.getItem(PENDING_LOGIN_LANGUAGE_KEY);
  sessionStorage.removeItem(PENDING_LOGIN_LANGUAGE_KEY);
  return language ? normalizeLanguageCode(language) : null;
}

export default i18n;
