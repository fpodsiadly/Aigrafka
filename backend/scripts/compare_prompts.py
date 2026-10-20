#!/usr/bin/env python3
"""A/B comparison of the legacy and the current try-on prompt.

Renders every case with both prompts on the same model and writes a side-by-side
HTML report. Needs GEMINI_API_KEY (no database or Redis).

Usage (from backend/):
    GEMINI_API_KEY=... python scripts/compare_prompts.py cases.json --out ab-report

cases.json (image paths are relative to the file):
    [
      {"name": "sweter", "selfie": "selfie.jpg", "product": "sweter.jpg",
       "category": "Sweter", "fit_style": "masculine",
       "height_cm": "180", "chest_cm": "100", "waist_cm": "86", "hips_cm": "98",
       "product_name": "Sweter Nordic", "product_details": "Kolor: zielony. Materiał: wełna"}
    ]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import html
import io
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
# Settings require these, but the comparison never touches the database or auth.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://unused:unused@localhost:5432/unused")
os.environ.setdefault("JWT_SECRET", "prompt-comparison-only-secret-not-used-anywhere")

from PIL import Image  # noqa: E402

from app.ai.gemini_client import GeminiClient  # noqa: E402
from app.ai.prompts.openvto_prompt import build_openvto_prompt  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from scripts.legacy_openvto_prompt import build_openvto_prompt as build_legacy_prompt  # noqa: E402

MEASUREMENT_KEYS = ("height_cm", "chest_cm", "waist_cm", "hips_cm")


def load_image(path: Path) -> bytes:
    """Normalise like the API does: RGB JPEG, longest side MAX_SIDE_PX."""
    max_side = get_settings().max_side_px
    with Image.open(path) as source:
        image = source.convert("RGB")
    scale = min(1.0, max_side / max(image.size))
    if scale < 1.0:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def prompts_for(case: dict) -> dict[str, str]:
    measurements = {key: case.get(key) for key in MEASUREMENT_KEYS}
    return {
        "legacy": build_legacy_prompt(
            "uploaded product image",
            is_upload=True,
            category=case.get("category"),
            fit_style=case.get("fit_style"),
            **measurements,
        ),
        "new": build_openvto_prompt(
            category=case.get("category"),
            fit_style=case.get("fit_style"),
            product_name=case.get("product_name"),
            product_details=case.get("product_details"),
            **measurements,
        ),
    }


async def render(client: GeminiClient, prompt: str, selfie: bytes, product: bytes, target: Path) -> dict:
    result = await client.generate_image(prompt, selfie, product)
    if result.get("status") != "generated":
        return {"ok": False, "error": result.get("error") or result.get("status")}
    extension = (result.get("mime_type") or "image/png").split("/")[-1]
    path = target.with_suffix(f".{extension}")
    path.write_bytes(base64.b64decode(result["image_base64"]))
    return {"ok": True, "file": path.name}


def cell(entry: dict, case_dir: str) -> str:
    if not entry["ok"]:
        return f'<div class="error">{html.escape(str(entry["error"]))}</div>'
    return f'<img src="{html.escape(case_dir)}/{html.escape(entry["file"])}" alt="">'


def write_report(out_dir: Path, results: list[dict], model: str) -> Path:
    rows = []
    for item in results:
        name = html.escape(item["name"])
        legacy = "".join(cell(entry, item["name"]) for entry in item["legacy"])
        new = "".join(cell(entry, item["name"]) for entry in item["new"])
        rows.append(
            f"<section><h2>{name}</h2><div class='grid'>"
            f"<div><h3>Stary prompt</h3>{legacy}<details><summary>Prompt</summary>"
            f"<pre>{html.escape(item['prompts']['legacy'])}</pre></details></div>"
            f"<div><h3>Nowy prompt</h3>{new}<details><summary>Prompt</summary>"
            f"<pre>{html.escape(item['prompts']['new'])}</pre></details></div>"
            "</div></section>"
        )
    report = out_dir / "index.html"
    report.write_text(
        "<!doctype html><html lang='pl'><head><meta charset='utf-8'><title>AIgrafka A/B promptów</title>"
        "<style>body{font-family:system-ui;margin:24px;background:#f4f4f4}"
        ".grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}"
        "img{width:100%;max-width:420px;display:block;margin-bottom:8px;border-radius:8px}"
        ".error{color:#a61b1b;font-weight:700}pre{white-space:pre-wrap;font-size:12px}"
        "section{background:#fff;padding:16px;border-radius:12px;margin-bottom:24px}</style></head><body>"
        f"<h1>Porównanie promptów</h1><p>Model: {html.escape(model)}</p>{''.join(rows)}</body></html>",
        encoding="utf-8",
    )
    return report


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cases", type=Path, help="JSON file with comparison cases")
    parser.add_argument("--out", type=Path, default=Path("ab-report"), help="output directory")
    parser.add_argument("--repeats", type=int, default=1, help="renders per prompt and case")
    parser.add_argument("--model", default=None, help="model id (default: GEMINI_MODEL setting)")
    args = parser.parse_args()

    if not get_settings().gemini_api_key:
        sys.exit("GEMINI_API_KEY is not set")
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    client = GeminiClient(model=args.model)
    results = []
    for case in cases:
        name = case["name"]
        case_dir = args.out / name
        case_dir.mkdir(parents=True, exist_ok=True)
        selfie = load_image(args.cases.parent / case["selfie"])
        product = load_image(args.cases.parent / case["product"])
        prompts = prompts_for(case)
        item = {"name": name, "prompts": prompts, "legacy": [], "new": []}
        for variant in ("legacy", "new"):
            for repeat in range(1, args.repeats + 1):
                print(f"{name}: {variant} #{repeat}...", flush=True)
                item[variant].append(await render(client, prompts[variant], selfie, product, case_dir / f"{variant}-{repeat}"))
        results.append(item)

    report = write_report(args.out, results, client.model)
    print(f"Report: {report.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
