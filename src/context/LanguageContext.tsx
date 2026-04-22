import React from 'react';

export type AvailableLocale =
  | 'da'
  | 'de'
  | 'en'
  | 'es'
  | 'fr'
  | 'hu'
  | 'it'
  | 'ja'
  | 'nl'
  | 'pt-BR'
  | 'ru'
  | 'sv'
  | 'uk'
  | 'zh-Hans';

type AvailableLanguageObject = Record<
  string,
  { code: AvailableLocale; display: string }
>;

export const availableLanguages: AvailableLanguageObject = {
  en: {
    code: 'en',
    display: 'English',
  },
  da: {
    code: 'da',
    display: 'Dansk',
  },
  de: {
    code: 'de',
    display: 'Deutsch',
  },
  es: {
    code: 'es',
    display: 'Español',
  },
  fr: {
    code: 'fr',
    display: 'Français',
  },
  hu: {
    code: 'hu',
    display: 'Magyar',
  },
  it: {
    code: 'it',
    display: 'Italiano',
  },
  ja: {
    code: 'ja',
    display: '日本語',
  },
  nl: {
    code: 'nl',
    display: 'Nederlands',
  },
  'pt-BR': {
    code: 'pt-BR',
    display: 'Português (Brasil)',
  },
  ru: {
    code: 'ru',
    display: 'Русский',
  },
  sv: {
    code: 'sv',
    display: 'Svenska',
  },
  uk: {
    code: 'uk',
    display: 'Українська',
  },
  'zh-Hans': {
    code: 'zh-Hans',
    display: '中文（简体）',
  },
};

export interface LanguageContextProps {
  locale: AvailableLocale;
  children: (locale: string) => React.ReactNode;
  setLocale?: React.Dispatch<React.SetStateAction<AvailableLocale>>;
}

export const LanguageContext = React.createContext<
  Omit<LanguageContextProps, 'children'>
>({
  locale: 'en',
});
