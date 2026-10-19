import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from './safeUrl';

describe('isSafeExternalUrl', () => {
    it.each(['https://shop.test/img.jpg', 'http://cdn.example.com/a.webp', 'https://8.8.8.8/x.png'])(
        'allows public http(s) URL %s',
        (url) => {
            expect(isSafeExternalUrl(url)).toBe(true);
        }
    );

    it.each([
        'file:///etc/passwd',
        'data:image/png;base64,AAAA',
        'http://localhost:8000/admin',
        'http://router.local/',
        'http://10.0.0.5/',
        'http://192.168.1.1/',
        'http://172.20.0.1/',
        'http://169.254.169.254/latest/meta-data',
        'http://[::1]/',
        'not a url',
    ])('blocks unsafe URL %s', (url) => {
        expect(isSafeExternalUrl(url)).toBe(false);
    });
});
