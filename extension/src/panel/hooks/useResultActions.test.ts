import { describe, expect, it } from 'vitest';

import { imageFileExtension } from './useResultActions';

describe('imageFileExtension', () => {
    it('matches the generated image type', () => {
        expect(imageFileExtension('image/webp')).toBe('webp');
        expect(imageFileExtension('image/png')).toBe('png');
        expect(imageFileExtension('image/jpeg')).toBe('jpg');
        expect(imageFileExtension('')).toBe('jpg');
    });
});
