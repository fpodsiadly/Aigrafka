import { describe, expect, it } from 'vitest';

import { findSizeRow, parseRange, parseSizeChart, recommendSize } from './sizeChart';

const ROWS_AS_SIZES = [
    ['Rozmiar', 'Obwód klatki (cm)', 'Talia (cm)', 'Biodra (cm)'],
    ['S', '88-92', '76–80', '90-94'],
    ['M', '96-100', '80-84', '96 - 100'],
    ['L', '104-108', '88-92', '102-106'],
];

describe('parseSizeChart', () => {
    it('reads sizes as rows and normalises ranges', () => {
        expect(parseSizeChart(ROWS_AS_SIZES)).toEqual([
            { size: 'S', chest: '88-92', waist: '76-80', hips: '90-94' },
            { size: 'M', chest: '96-100', waist: '80-84', hips: '96-100' },
            { size: 'L', chest: '104-108', waist: '88-92', hips: '102-106' },
        ]);
    });

    it('reads sizes as columns (transposed tables)', () => {
        const chart = parseSizeChart([
            ['Size', 'S', 'M'],
            ['Chest', '88-92', '96-100'],
            ['Waist', '76-80', '80-84'],
        ]);

        expect(chart).toEqual([
            { size: 'S', chest: '88-92', waist: '76-80' },
            { size: 'M', chest: '96-100', waist: '80-84' },
        ]);
    });

    it('ignores tables that are not size charts', () => {
        expect(parseSizeChart([['Produkt', 'Cena'], ['Sweter', '199 zł']])).toBeNull();
        expect(parseSizeChart([])).toBeNull();
    });
});

describe('recommendSize', () => {
    const chart = parseSizeChart(ROWS_AS_SIZES);

    it('picks the size whose ranges contain the body', () => {
        expect(recommendSize(chart, { chest: '98', waist: '82', hips: '97' })?.size).toBe('M');
    });

    it('prefers a slightly loose size over a tight one between sizes', () => {
        expect(recommendSize(chart, { chest: '102' })?.size).toBe('L');
    });

    it('needs at least one measurement to compare', () => {
        expect(recommendSize(chart, {})).toBeNull();
        expect(recommendSize(null, { chest: '98' })).toBeNull();
    });
});

describe('helpers', () => {
    it('parses single values and ranges with units', () => {
        expect(parseRange('96 cm')).toEqual([96, 96]);
        expect(parseRange('100/96')).toEqual([96, 100]);
        expect(parseRange('M')).toBeNull();
    });

    it('finds a chart row case-insensitively', () => {
        expect(findSizeRow(parseSizeChart(ROWS_AS_SIZES), ' m ')?.chest).toBe('96-100');
        expect(findSizeRow(parseSizeChart(ROWS_AS_SIZES), '')).toBeUndefined();
    });
});
