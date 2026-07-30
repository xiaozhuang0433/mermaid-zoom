import { getLanguage } from 'obsidian';

import en from './locale/en.json';
import zh from './locale/zh.json';
import zhTw from './locale/zh-TW.json';
import ja from './locale/ja.json';
import de from './locale/de.json';
import es from './locale/es.json';
import fr from './locale/fr.json';
import ru from './locale/ru.json';
import ptBr from './locale/pt-BR.json';
import ko from './locale/ko.json';

// Resolve the user's interface language via Obsidian's getLanguage() (returns
// an ISO code such as "en", "zh", "zh-TW", "ja", "ru"; defaults to "en") and
// map it to a translation dict, falling back to English for any language or
// key we don't ship.
//
// Non-English translations are initial AI drafts — native-speaker refinements
// welcome (add a locale/xx.json and register it below).
const translations: Record<string, Record<string, string>> = {
	en,
	zh,
	'zh-TW': zhTw,
	ja,
	de,
	es,
	fr,
	ru,
	'pt-BR': ptBr,
	pt: ptBr, // European Portuguese falls back to the Brazilian translation.
	ko,
};

function resolveDict(lang: string): Record<string, string> {
	if (translations[lang]) return translations[lang];
	// "zh-TW" -> "zh": fall back to the base language when the exact code is absent.
	const base = lang.split('-')[0];
	return translations[base] ?? translations.en;
}

const dict = resolveDict(getLanguage());

/** Translate a key, falling back to English, then to the key itself. */
export function t(key: string): string {
	return dict[key] ?? translations.en[key] ?? key;
}
