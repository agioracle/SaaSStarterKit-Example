import {
  getLocale,
  getLocaleName,
  isLocale,
  localeConfig,
  locales,
  localizeUrl,
} from '../../lib/locale';
import { m } from '../../locale/paraglide/messages';

/** The actual navbar switcher, driven by the public locale configuration. */
export function LocaleSwitcher() {
  return (
    <select
      className="locale-button"
      value={getLocale()}
      aria-label={m.common_language()}
      onChange={(event) => {
        const locale = event.target.value;
        if (isLocale(locale))
          window.location.href = localizeUrl(window.location.href, { locale }).href;
      }}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {localeConfig[locale]?.flag ? `${localeConfig[locale].flag} ` : ''}
          {getLocaleName(locale)}
        </option>
      ))}
    </select>
  );
}
