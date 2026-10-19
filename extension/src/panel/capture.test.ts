import { describe, expect, it } from 'vitest';

import { pickLargestSrcsetUrl } from './capture';

const BASE = 'https://shop.test/products/shirt';

describe('pickLargestSrcsetUrl', () => {
    it('picks the widest width descriptor and resolves it against the page', () => {
        const srcset = '/img/shirt-400.jpg 400w, /img/shirt-1600.jpg 1600w, /img/shirt-800.jpg 800w';

        expect(pickLargestSrcsetUrl(srcset, BASE)).toBe('https://shop.test/img/shirt-1600.jpg');
    });

    it('ranks density descriptors and treats a missing descriptor as 1x', () => {
        expect(pickLargestSrcsetUrl('a.jpg, b.jpg 2x', BASE)).toBe('https://shop.test/products/b.jpg');
    });

    it('splits candidates separated by a comma without whitespace', () => {
        expect(pickLargestSrcsetUrl('a.jpg 1x,b.jpg 3x', BASE)).toBe('https://shop.test/products/b.jpg');
    });

    it('keeps commas that are part of CDN transform URLs', () => {
        const srcset = 'https://cdn.test/w_400,h_600/shirt.jpg 400w, https://cdn.test/w_1200,h_1800/shirt.jpg 1200w';

        expect(pickLargestSrcsetUrl(srcset, BASE)).toBe('https://cdn.test/w_1200,h_1800/shirt.jpg');
    });

    it('returns null for an empty srcset', () => {
        expect(pickLargestSrcsetUrl('  ', BASE)).toBeNull();
    });
});
