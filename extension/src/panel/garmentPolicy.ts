import type { FormState } from './types';

export interface GarmentCategory {
    readonly value: string;
    readonly label: string;
    readonly feminineOnly?: boolean;
    readonly intimate?: boolean;
}

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

export function getCategoryError(category: string, fitStyle: FormState['fitStyle']): string | null {
    if (!category) return 'Wybierz kategorię produktu.';

    const selectedCategory = GARMENT_CATEGORIES.find((item) => item.value === category);
    if (!selectedCategory) return 'Wybrana kategoria produktu jest nieobsługiwana.';
    if (fitStyle !== 'masculine') return null;
    if (selectedCategory.intimate) {
        return 'Bielizna, stroje kąpielowe i kreacje intymne nie są dostępne dla mężczyzn.';
    }
    if (selectedCategory.feminineOnly) {
        return 'Ta kategoria damska nie jest dostępna dla mężczyzn.';
    }
    return null;
}
