import { describe, expect, it } from 'vitest';

import { useAppStore } from '../../store/appStore';
import { clearGenerationResults } from './useGeneration';

describe('clearGenerationResults', () => {
    it('removes generated images from the store and returns to the form', () => {
        const store = useAppStore.getState();
        store.setVariants([{ url: 'blob:https://shop.test/a' }]);
        store.setPreviewUrl('blob:https://shop.test/a');
        store.setView('result');

        clearGenerationResults();

        const cleared = useAppStore.getState();
        expect(cleared.variants).toEqual([]);
        expect(cleared.previewUrl).toBe('');
        expect(cleared.view).toBe('form');
    });
});
