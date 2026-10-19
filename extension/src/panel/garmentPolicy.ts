import type { FormState } from './types';

export interface GarmentCategory {
    readonly value: string;
    readonly label: string;
    readonly feminineOnly?: boolean;
    readonly intimate?: boolean;
}

// Suggestions for the free-text category field. `value` is the key older
// versions stored and sent; the backend still accepts it.
export const GARMENT_CATEGORIES: readonly GarmentCategory[] = [
    { value: 'tshirt', label: 'Koszulka' },
    { value: 'shirt', label: 'Koszula' },
    { value: 'hoodie', label: 'Bluza z kapturem' },
    { value: 'sweater', label: 'Sweter' },
    { value: 'jacket', label: 'Kurtka' },
    { value: 'coat', label: 'Płaszcz' },
    { value: 'trousers', label: 'Spodnie' },
    { value: 'jeans', label: 'Jeansy' },
    { value: 'shorts', label: 'Szorty' },
    { value: 'suit', label: 'Garnitur' },
    { value: 'womens_blouse', label: 'Bluzka damska', feminineOnly: true },
    { value: 'dress', label: 'Sukienka', feminineOnly: true },
    { value: 'skirt', label: 'Spódnica', feminineOnly: true },
    { value: 'womens_leggings', label: 'Legginsy damskie', feminineOnly: true },
    { value: 'underwear', label: 'Bielizna', intimate: true },
    { value: 'lingerie', label: 'Bielizna damska', feminineOnly: true, intimate: true },
    { value: 'bra', label: 'Biustonosz', feminineOnly: true, intimate: true },
    { value: 'swimwear', label: 'Strój kąpielowy', intimate: true },
    { value: 'bikini', label: 'Bikini', feminineOnly: true, intimate: true },
] as const;

// Matches backend/app/ai/garment_policy.py so the form flags what the API rejects.
export const MAX_CATEGORY_LENGTH = 60;
const INTIMATE_STEMS = [
    'bieliz', 'majt', 'stanik', 'biustonosz', 'stringi', 'figi', 'bokserk', 'slipy',
    'kapiel', 'bikini', 'lingerie', 'underwear', 'swim', 'panties', 'thong',
];
const INTIMATE_WORDS = ['bra', 'bras', 'boxers', 'briefs'];
const FEMININE_STEMS = ['sukien', 'sukni', 'spodnic', 'damsk', 'legginsy', 'women'];
const FEMININE_WORDS = ['dress', 'dresses', 'skirt', 'skirts', 'blouse', 'blouses', 'leggings'];

function fold(text: string): string {
    return text
        .toLowerCase()
        .replace(/ł/g, 'l')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '');
}

function categoryFlags(category: string): { feminineOnly: boolean; intimate: boolean } {
    const legacy = GARMENT_CATEGORIES.find((item) => item.value === category);
    if (legacy) return { feminineOnly: Boolean(legacy.feminineOnly), intimate: Boolean(legacy.intimate) };

    const folded = fold(category);
    const words = new Set(folded.match(/[a-z]+/g) ?? []);
    return {
        intimate: INTIMATE_STEMS.some((stem) => folded.includes(stem)) || INTIMATE_WORDS.some((word) => words.has(word)),
        feminineOnly: FEMININE_STEMS.some((stem) => folded.includes(stem)) || FEMININE_WORDS.some((word) => words.has(word)),
    };
}

/** Show a stored legacy key (e.g. "sweater") as its Polish label in the text field. */
export function toCategoryText(category: string): string {
    return GARMENT_CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

export function getCategoryError(category: string, fitStyle: FormState['fitStyle']): string | null {
    if (!category.trim()) return 'Wpisz, co przymierzasz (np. sweter, kurtka).';
    if (fitStyle !== 'masculine') return null;
    const { intimate, feminineOnly } = categoryFlags(category);
    if (intimate) {
        return 'Bielizna, stroje kąpielowe i kreacje intymne nie są dostępne dla mężczyzn.';
    }
    if (feminineOnly) {
        return 'Ta kategoria damska nie jest dostępna dla mężczyzn.';
    }
    return null;
}
