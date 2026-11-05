import { describe, expect, it } from 'vitest';

import { imageFileExtension, shareableLink } from './useResultActions';

describe('imageFileExtension', () => {
    it('matches the generated image type', () => {
        expect(imageFileExtension('image/webp')).toBe('webp');
        expect(imageFileExtension('image/png')).toBe('png');
        expect(imageFileExtension('image/jpeg')).toBe('jpg');
        expect(imageFileExtension('')).toBe('jpg');
    });
});

describe('shareableLink', () => {
    it('drops tab-local blob: and data: URLs', () => {
        expect(shareableLink('blob:https://shop.test/uuid')).toBe('');
        expect(shareableLink('data:image/png;base64,AAAA')).toBe('');
        expect(shareableLink(undefined)).toBe('');
        expect(shareableLink('https://api.test/images/a')).toBe('https://api.test/images/a');
    });
});
