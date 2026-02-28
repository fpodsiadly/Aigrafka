#!/usr/bin/env python3
"""A/B benchmark for /generate latency.

Measures end-to-end request time and backend-reported first variant latency
for two environments (A and B), then prints median/mean/p95 comparison.
"""

from __future__ import annotations

import argparse
import json
import math
import mimetypes
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import httpx


@dataclass
class RunResult:
    ok: bool
    status_code: int
    client_ms: float
    backend_ms: Optional[float]
    model: Optional[str]
    error: Optional[str]


@dataclass
class Summary:
    label: str
    runs: int
    ok_runs: int
    fail_runs: int
    success_rate: float
    median_client_ms: Optional[float]
    mean_client_ms: Optional[float]
    p95_client_ms: Optional[float]
    median_backend_ms: Optional[float]
    mean_backend_ms: Optional[float]
    p95_backend_ms: Optional[float]


def percentile(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    sorted_values = sorted(values)
    rank = (len(sorted_values) - 1) * (p / 100)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_values[low]
    frac = rank - low
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * frac


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark /generate endpoint for A/B comparison")
    parser.add_argument("--url-a", required=True, help="Base URL A (e.g. https://api-old.onrender.com)")
    parser.add_argument("--url-b", required=True, help="Base URL B (e.g. https://api-new.onrender.com)")
    parser.add_argument("--selfie", required=True, type=Path, help="Path to selfie image")
    parser.add_argument("--product", required=True, type=Path, help="Path to product image")
    parser.add_argument("--iterations", type=int, default=20, help="Requests per variant (default: 20)")
    parser.add_argument("--warmup", type=int, default=2, help="Warmup requests per variant (default: 2)")
    parser.add_argument("--pause-ms", type=int, default=400, help="Pause between requests in ms")
    parser.add_argument("--timeout", type=float, default=120.0, help="HTTP timeout in seconds")
    parser.add_argument("--model-choice", default="banana-pro-2", help="model_choice form field")
    parser.add_argument("--variants", type=int, default=1, choices=[1, 2, 3], help="variants form field")
    parser.add_argument("--category", default="hoodie", help="category form field")
    parser.add_argument("--fit-style", default="masculine", choices=["masculine", "feminine", "unisex"], help="fit_style form field")
    parser.add_argument("--token", default=None, help="Optional bearer token")
    parser.add_argument("--json-out", type=Path, default=None, help="Optional path to save raw JSON report")
    return parser


def guess_content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "image/jpeg"


def first_variant_latency(payload: dict[str, Any]) -> Optional[float]:
    variants = payload.get("variants")
    if isinstance(variants, list) and variants:
        first = variants[0]
        if isinstance(first, dict):
            latency = first.get("latency_ms")
            if isinstance(latency, (float, int)):
                return float(latency)
    return None


def run_once(
    client: httpx.Client,
    base_url: str,
    selfie_path: Path,
    product_path: Path,
    form_data: dict[str, str],
    headers: dict[str, str],
) -> RunResult:
    started = time.perf_counter()
    try:
        with selfie_path.open("rb") as selfie_fp, product_path.open("rb") as product_fp:
            files = {
                "selfie": (selfie_path.name, selfie_fp, guess_content_type(selfie_path)),
                "product_image_1": (product_path.name, product_fp, guess_content_type(product_path)),
            }
            response = client.post(f"{base_url.rstrip('/')}/generate", data=form_data, files=files, headers=headers)

        elapsed_ms = (time.perf_counter() - started) * 1000

        if response.status_code >= 400:
            detail = None
            try:
                payload = response.json()
                detail = payload.get("detail") if isinstance(payload, dict) else None
            except Exception:
                detail = response.text.strip()[:500] or None
            return RunResult(
                ok=False,
                status_code=response.status_code,
                client_ms=elapsed_ms,
                backend_ms=None,
                model=None,
                error=str(detail or f"HTTP {response.status_code}"),
            )

        payload = response.json()
        model = payload.get("model") if isinstance(payload, dict) else None
        backend_ms = first_variant_latency(payload if isinstance(payload, dict) else {})

        return RunResult(
            ok=True,
            status_code=response.status_code,
            client_ms=elapsed_ms,
            backend_ms=backend_ms,
            model=str(model) if model else None,
            error=None,
        )
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return RunResult(
            ok=False,
            status_code=0,
            client_ms=elapsed_ms,
            backend_ms=None,
            model=None,
            error=str(exc),
        )


def summarize(label: str, results: list[RunResult]) -> Summary:
    ok = [r for r in results if r.ok]
    client_values = [r.client_ms for r in ok]
    backend_values = [r.backend_ms for r in ok if r.backend_ms is not None]

    def safe_mean(values: list[float]) -> Optional[float]:
        return statistics.mean(values) if values else None

    def safe_median(values: list[float]) -> Optional[float]:
        return statistics.median(values) if values else None

    return Summary(
        label=label,
        runs=len(results),
        ok_runs=len(ok),
        fail_runs=len(results) - len(ok),
        success_rate=(len(ok) / len(results) * 100.0) if results else 0.0,
        median_client_ms=safe_median(client_values),
        mean_client_ms=safe_mean(client_values),
        p95_client_ms=percentile(client_values, 95),
        median_backend_ms=safe_median(backend_values),
        mean_backend_ms=safe_mean(backend_values),
        p95_backend_ms=percentile(backend_values, 95),
    )


def fmt(v: Optional[float]) -> str:
    return "-" if v is None else f"{v:.1f}"


def delta_pct(new: Optional[float], old: Optional[float]) -> str:
    if new is None or old is None or old == 0:
        return "-"
    diff = ((new - old) / old) * 100.0
    sign = "+" if diff > 0 else ""
    return f"{sign}{diff:.1f}%"


def run_group(
    label: str,
    base_url: str,
    client: httpx.Client,
    selfie_path: Path,
    product_path: Path,
    form_data: dict[str, str],
    headers: dict[str, str],
    warmup: int,
    iterations: int,
    pause_ms: int,
) -> list[RunResult]:
    print(f"\n=== {label} ({base_url}) ===")
    for i in range(warmup):
        _ = run_once(client, base_url, selfie_path, product_path, form_data, headers)
        print(f"warmup {i + 1}/{warmup} done")
        if pause_ms > 0:
            time.sleep(pause_ms / 1000)

    results: list[RunResult] = []
    for i in range(iterations):
        result = run_once(client, base_url, selfie_path, product_path, form_data, headers)
        results.append(result)
        marker = "OK" if result.ok else "ERR"
        print(
            f"{i + 1:02d}/{iterations:02d} {marker} "
            f"client={result.client_ms:.1f}ms backend={fmt(result.backend_ms)}ms "
            f"status={result.status_code}"
        )
        if pause_ms > 0:
            time.sleep(pause_ms / 1000)
    return results


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.selfie.exists():
        raise FileNotFoundError(f"Selfie not found: {args.selfie}")
    if not args.product.exists():
        raise FileNotFoundError(f"Product image not found: {args.product}")

    form_data = {
        "model_choice": args.model_choice,
        "variants": str(args.variants),
        "category": args.category,
        "fit_style": args.fit_style,
    }

    headers: dict[str, str] = {}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"

    timeout = httpx.Timeout(args.timeout)

    with httpx.Client(timeout=timeout) as client:
        results_a = run_group(
            label="A",
            base_url=args.url_a,
            client=client,
            selfie_path=args.selfie,
            product_path=args.product,
            form_data=form_data,
            headers=headers,
            warmup=args.warmup,
            iterations=args.iterations,
            pause_ms=args.pause_ms,
        )
        results_b = run_group(
            label="B",
            base_url=args.url_b,
            client=client,
            selfie_path=args.selfie,
            product_path=args.product,
            form_data=form_data,
            headers=headers,
            warmup=args.warmup,
            iterations=args.iterations,
            pause_ms=args.pause_ms,
        )

    summary_a = summarize("A", results_a)
    summary_b = summarize("B", results_b)

    print("\n=== SUMMARY ===")
    print("metric                         A            B            delta(B vs A)")
    print("-----------------------------------------------------------------------")
    print(f"success_rate(%)               {summary_a.success_rate:>8.1f}     {summary_b.success_rate:>8.1f}     {delta_pct(summary_b.success_rate, summary_a.success_rate):>10}")
    print(f"median_client_ms              {fmt(summary_a.median_client_ms):>8}     {fmt(summary_b.median_client_ms):>8}     {delta_pct(summary_b.median_client_ms, summary_a.median_client_ms):>10}")
    print(f"p95_client_ms                 {fmt(summary_a.p95_client_ms):>8}     {fmt(summary_b.p95_client_ms):>8}     {delta_pct(summary_b.p95_client_ms, summary_a.p95_client_ms):>10}")
    print(f"median_backend_ms             {fmt(summary_a.median_backend_ms):>8}     {fmt(summary_b.median_backend_ms):>8}     {delta_pct(summary_b.median_backend_ms, summary_a.median_backend_ms):>10}")
    print(f"p95_backend_ms                {fmt(summary_a.p95_backend_ms):>8}     {fmt(summary_b.p95_backend_ms):>8}     {delta_pct(summary_b.p95_backend_ms, summary_a.p95_backend_ms):>10}")

    models_a = sorted({r.model for r in results_a if r.model})
    models_b = sorted({r.model for r in results_b if r.model})
    if models_a:
        print(f"models A: {', '.join(models_a)}")
    if models_b:
        print(f"models B: {', '.join(models_b)}")

    if args.json_out:
        payload = {
            "config": {
                "url_a": args.url_a,
                "url_b": args.url_b,
                "iterations": args.iterations,
                "warmup": args.warmup,
                "pause_ms": args.pause_ms,
                "model_choice": args.model_choice,
                "variants": args.variants,
                "category": args.category,
                "fit_style": args.fit_style,
            },
            "summary": {
                "a": summary_a.__dict__,
                "b": summary_b.__dict__,
            },
            "runs": {
                "a": [r.__dict__ for r in results_a],
                "b": [r.__dict__ for r in results_b],
            },
        }
        args.json_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nRaw report saved to: {args.json_out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
