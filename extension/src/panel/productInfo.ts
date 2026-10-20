// Product name/description read from the shop page the panel runs on. Sent to
// the backend so the prompt can describe the garment (material, colour) beyond
// what the product photo shows.

export interface ProductInfo {
    name: string;
    details: string;
    // Short category suggestion for the free-text category field ('' if unknown).
    category: string;
}

const MAX_NAME_LENGTH = 120;
const MAX_DETAILS_LENGTH = 400;
const MAX_CATEGORY_LENGTH = 60;

type JsonLdNode = Record<string, unknown>;

function asText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
    if (value && typeof value === 'object') {
        const node = value as JsonLdNode;
        return asText(node.name ?? node.value ?? '');
    }
    return '';
}

function clean(text: string, maxLength: number): string {
    // Strip HTML that some shops put in JSON-LD descriptions, collapse whitespace.
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function isProduct(node: JsonLdNode): boolean {
    const type = node['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.includes('Product') || types.includes('ProductGroup');
}

function findProduct(node: unknown): JsonLdNode | null {
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findProduct(item);
            if (found) return found;
        }
        return null;
    }
    if (!node || typeof node !== 'object') return null;
    const record = node as JsonLdNode;
    if (isProduct(record)) return record;
    return findProduct(record['@graph']);
}

function lastCategorySegment(category: string): string {
    const segments = category.split(/\s*[>/|]\s*/).filter(Boolean);
    return clean(segments[segments.length - 1] ?? '', MAX_CATEGORY_LENGTH);
}

/** Parse schema.org Product data from the page's JSON-LD script contents. */
export function parseProductJsonLd(blocks: string[]): ProductInfo | null {
    for (const block of blocks) {
        let data: unknown;
        try {
            data = JSON.parse(block);
        } catch {
            continue;
        }
        const product = findProduct(data);
        if (!product) continue;

        const name = clean(asText(product.name), MAX_NAME_LENGTH);
        const facts = [
            ['Marka', asText(product.brand)],
            ['Kolor', asText(product.color)],
            ['Materiał', asText(product.material)],
            ['Opis', asText(product.description)],
        ]
            .filter(([, value]) => value.trim())
            .map(([label, value]) => `${label}: ${clean(value, MAX_DETAILS_LENGTH)}`);
        const details = clean(facts.join('. '), MAX_DETAILS_LENGTH);
        if (!name && !details) continue;
        return { name, details, category: lastCategorySegment(asText(product.category)) };
    }
    return null;
}

/** Read product info from a shop page: JSON-LD Product first, Open Graph tags as a fallback. */
export function extractProductInfo(doc: Document): ProductInfo | null {
    const blocks = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
        (script) => script.textContent ?? ''
    );
    const fromJsonLd = parseProductJsonLd(blocks);
    if (fromJsonLd) return fromJsonLd;

    const meta = (property: string) =>
        doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute('content') ?? '';
    const name = clean(meta('og:title'), MAX_NAME_LENGTH);
    const details = clean(meta('og:description'), MAX_DETAILS_LENGTH);
    if (!name && !details) return null;
    return { name, details, category: '' };
}
