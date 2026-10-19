import { describe, expect, it } from 'vitest';

import { getCategoryError, toCategoryText } from './garmentPolicy';

describe('getCategoryError', () => {
    it('requires some text', () => {
        expect(getCategoryError('  ', 'unisex')).toContain('Wpisz');
    });

    it('accepts any free-text garment for feminine and unisex fits', () => {
        expect(getCategoryError('Kardigan oversize', 'unisex')).toBeNull();
        expect(getCategoryError('Bielizna', 'feminine')).toBeNull();
    });

    it.each(['Strój kąpielowy', 'STRÓJ KAPIELOWY', 'majtki', 'push-up bra', 'swimwear'])(
        'blocks intimate "%s" for the masculine fit',
        (category) => {
            expect(getCategoryError(category, 'masculine')).toContain('nie są dostępne dla mężczyzn');
        }
    );

    it.each(['Sukienka', 'spódnica', 'kurtka damska', 'summer dress', 'dress'])(
        'blocks feminine-only "%s" for the masculine fit',
        (category) => {
            expect(getCategoryError(category, 'masculine')).toBe('Ta kategoria damska nie jest dostępna dla mężczyzn.');
        }
    );

    it('does not over-match words that only contain a keyword', () => {
        expect(getCategoryError('brazylijska koszula', 'masculine')).toBeNull();
        expect(getCategoryError('Spodnie chino', 'masculine')).toBeNull();
    });
});

describe('toCategoryText', () => {
    it('maps legacy dropdown keys to their Polish label and keeps free text', () => {
        expect(toCategoryText('sweater')).toBe('Sweter');
        expect(toCategoryText('Kardigan')).toBe('Kardigan');
    });
});
