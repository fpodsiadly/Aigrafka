// Token purchase: price formatting and the consents shown before paying.

// TODO: replace with the final, approved consent wording.
export const PURCHASE_TERMS_CONSENT =
    '[Tekst zgody do uzupełnienia] Akceptuję Regulamin i Politykę prywatności AIgrafka.';
export const PURCHASE_DIGITAL_CONTENT_CONSENT =
    '[Tekst zgody do uzupełnienia] Żądam dostarczenia tokenów stylizacji przed upływem 14 dni od zakupu ' +
    'i przyjmuję do wiadomości, że w ten sposób tracę prawo odstąpienia od umowy.';

export interface TokenPack {
    tokens: number;
    priceGrosze: number;
    currency: string;
}

export function formatPrice(priceGrosze: number, currency: string): string {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(priceGrosze / 100);
}

// Polish plural: 1 token, 2-4 tokeny (but 12-14 tokenów), otherwise tokenów.
function tokensWord(count: number): string {
    if (count === 1) return 'token';
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    return lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14) ? 'tokeny' : 'tokenów';
}

export function describePack(pack: TokenPack): string {
    return `${pack.tokens} ${tokensWord(pack.tokens)} stylizacji za ${formatPrice(pack.priceGrosze, pack.currency)}`;
}
