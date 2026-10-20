import { describe, expect, it } from 'vitest';

import { parseProductJsonLd } from './productInfo';

describe('parseProductJsonLd', () => {
    it('reads name, brand, colour, material, description and the last category segment', () => {
        const info = parseProductJsonLd([
            JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Sweter Nordic',
                brand: { '@type': 'Brand', name: 'Wool&Co' },
                color: 'butelkowa zieleń',
                material: ['wełna merino', 'kaszmir'],
                description: '<p>Ciepły sweter <b>oversize</b>.</p>',
                category: 'Odzież > Męskie > Swetry',
            }),
        ]);

        expect(info).toEqual({
            name: 'Sweter Nordic',
            details: 'Marka: Wool&Co. Kolor: butelkowa zieleń. Materiał: wełna merino, kaszmir. Opis: Ciepły sweter oversize .',
            category: 'Swetry',
        });
    });

    it('finds the product inside @graph and skips invalid blocks', () => {
        const info = parseProductJsonLd([
            '{not json',
            JSON.stringify({ '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': ['Product'], name: 'Kurtka' }] }),
        ]);

        expect(info?.name).toBe('Kurtka');
        expect(info?.category).toBe('');
    });

    it('returns null when the page has no product data', () => {
        expect(parseProductJsonLd([JSON.stringify({ '@type': 'Organization', name: 'Shop' })])).toBeNull();
    });

    it('bounds long descriptions', () => {
        const info = parseProductJsonLd([JSON.stringify({ '@type': 'Product', name: 'X', description: 'a'.repeat(2000) })]);

        expect(info?.details.length).toBeLessThanOrEqual(400);
    });
});
