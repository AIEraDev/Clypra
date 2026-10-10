import enCatalog from "./en.json";
import ruCatalog from "./ru.json";
import esCatalog from "./es.json";
import jaCatalog from "./ja.json";
import deCatalog from "./de.json";
import frCatalog from "./fr.json";
import koCatalog from "./ko.json";
import zhCnCatalog from "./zh-CN.json";
import zhTwCatalog from "./zh-TW.json";

export type TranslationKey = keyof typeof enCatalog;

export const catalogs = {
  en: enCatalog,
  ru: ruCatalog,
  es: esCatalog,
  ja: jaCatalog,
  de: deCatalog,
  fr: frCatalog,
  ko: koCatalog,
  "zh-CN": zhCnCatalog,
  "zh-TW": zhTwCatalog,
} as const;

export {
  enCatalog,
  ruCatalog,
  esCatalog,
  jaCatalog,
  deCatalog,
  frCatalog,
  koCatalog,
  zhCnCatalog,
  zhTwCatalog,
};
