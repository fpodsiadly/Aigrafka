// Size chart read from the shop page: per size, the body measurements (cm)
// the size is cut for. Used to recommend a size and to describe the fit.

export interface SizeChartRow {
    size: string;
    chest?: string;
    waist?: string;
    hips?: string;
}

type Measurement = 'chest' | 'waist' | 'hips';
type Column = 'size' | Measurement;

const HEADERS: Record<Column, RegExp> = {
    size: /rozmiar|size|^eu$|^pl$|^int/i,
    chest: /klat|biust|chest|bust/i,
    waist: /talia|w pasie|waist/i,
    hips: /biodr|hip/i,
};
const MEASUREMENTS: Measurement[] = ['chest', 'waist', 'hips'];
const RANGE = /^(\d+(?:[.,]\d+)?)\s*(?:[-–/]\s*(\d+(?:[.,]\d+)?))?\s*(?:cm)?$/i;

export function parseRange(value: string | undefined): [number, number] | null {
    const match = value?.trim().match(RANGE);
    if (!match) return null;
    const low = Number(match[1].replace(',', '.'));
    const high = Number((match[2] ?? match[1]).replace(',', '.'));
    return [Math.min(low, high), Math.max(low, high)];
}

function normalizeRange(value: string): string | undefined {
    const range = parseRange(value);
    if (!range) return undefined;
    return range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`;
}

function columnIndexes(header: string[]): Partial<Record<Column, number>> {
    const indexes: Partial<Record<Column, number>> = {};
    header.forEach((cell, index) => {
        for (const column of Object.keys(HEADERS) as Column[]) {
            if (indexes[column] === undefined && HEADERS[column].test(cell.trim())) {
                indexes[column] = index;
                break;
            }
        }
    });
    return indexes;
}

function parseRowsAsSizes(table: string[][]): SizeChartRow[] | null {
    const [header, ...body] = table;
    if (!header) return null;
    const indexes = columnIndexes(header);
    if (indexes.size === undefined || !MEASUREMENTS.some((m) => indexes[m] !== undefined)) return null;

    const rows = body
        .map((cells) => {
            const row: SizeChartRow = { size: (cells[indexes.size as number] ?? '').trim() };
            for (const measurement of MEASUREMENTS) {
                const index = indexes[measurement];
                if (index !== undefined) row[measurement] = normalizeRange(cells[index] ?? '');
            }
            return row;
        })
        .filter((row) => row.size && MEASUREMENTS.some((m) => row[m]));
    return rows.length ? rows : null;
}

function transpose(table: string[][]): string[][] {
    const width = Math.max(0, ...table.map((row) => row.length));
    return Array.from({ length: width }, (_, column) => table.map((row) => row[column] ?? ''));
}

/** Parse a size chart from table cell texts, with sizes either as rows or as columns. */
export function parseSizeChart(table: string[][]): SizeChartRow[] | null {
    return parseRowsAsSizes(table) ?? parseRowsAsSizes(transpose(table));
}

export function normalizeSize(size: string): string {
    return size.trim().toUpperCase();
}

export function findSizeRow(chart: SizeChartRow[] | null, size: string): SizeChartRow | undefined {
    const wanted = normalizeSize(size);
    return wanted ? chart?.find((row) => normalizeSize(row.size) === wanted) : undefined;
}

/**
 * Recommend the size whose ranges fit the body best. Being above a range
 * (tight) is penalised more than being below it (loose).
 */
export function recommendSize(
    chart: SizeChartRow[] | null,
    body: Partial<Record<Measurement, string>>
): SizeChartRow | null {
    if (!chart?.length) return null;
    let best: { row: SizeChartRow; penalty: number } | null = null;
    for (const row of chart) {
        let penalty = 0;
        let compared = 0;
        for (const measurement of MEASUREMENTS) {
            const range = parseRange(row[measurement]);
            const value = Number((body[measurement] ?? '').replace(',', '.'));
            if (!range || !value) continue;
            compared += 1;
            if (value > range[1]) penalty += (value - range[1]) * 1.5;
            else if (value < range[0]) penalty += range[0] - value;
        }
        if (compared && (!best || penalty < best.penalty)) best = { row, penalty };
    }
    return best?.row ?? null;
}

/** Find the first table on the page that parses as a size chart. */
export function extractSizeChart(doc: Document): SizeChartRow[] | null {
    for (const table of Array.from(doc.querySelectorAll('table'))) {
        const cells = Array.from(table.querySelectorAll('tr')).map((row) =>
            Array.from(row.querySelectorAll('th, td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        );
        const chart = parseSizeChart(cells);
        if (chart) return chart;
    }
    return null;
}
