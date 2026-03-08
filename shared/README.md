# Shared

Pelna dokumentacja projektu jest w glownym pliku: `../README.md`.

`shared/` zawiera wspolne typy TypeScript uzywane przez inne moduly.

## Plik

- `types.ts`

## Zasada

Nie duplikuj kontraktow typow w `extension/`, `backend/` i `ai/` - importuj je z `shared/types.ts`.
