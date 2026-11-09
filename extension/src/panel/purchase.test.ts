import { describe, expect, it } from 'vitest';

import { describePack, formatPrice } from './purchase';

describe('formatPrice', () => {
    it('formats grosze as a Polish currency amount', () => {
        expect(formatPrice(1000, 'PLN').replace(/\s/g, ' ')).toBe('10,00 zł');
        expect(formatPrice(1999, 'PLN').replace(/\s/g, ' ')).toBe('19,99 zł');
    });
});

describe('describePack', () => {
    it.each([
        [1, '1 token stylizacji'],
        [3, '3 tokeny stylizacji'],
        [5, '5 tokenów stylizacji'],
        [12, '12 tokenów stylizacji'],
        [22, '22 tokeny stylizacji'],
    ])('uses the right Polish plural for %i tokens', (tokens, expected) => {
        expect(describePack({ tokens, priceGrosze: 1000, currency: 'PLN' })).toContain(expected);
    });
});
