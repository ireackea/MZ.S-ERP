
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enTranslation from './locales/en/translation.json';
import arTranslation from './locales/ar/translation.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Gate 4.22 - was `true`, unconditionally, in a production build.
    //
    // `useTranslation` has no call site anywhere in the app, so nothing consumes this
    // and the debug output was pure console noise in front of operators — the kind
    // that trains people to ignore the console, which is where real errors go. The
    // honest options are to delete the initialisation or to switch the flag off and
    // keep the wiring; the second is the smaller change and keeps the language
    // detector available if a screen ever wants it.
    debug: import.meta.env.DEV,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    resources: {
      en: {
        translation: enTranslation,
      },
      ar: {
        translation: arTranslation,
      },
    },
  });

export default i18n;
