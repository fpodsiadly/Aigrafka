"""Lightweight in-process metrics for observability.

Counters and histograms are stored in Redis when available,
falling back to process-local dicts. Exposed via GET /metrics
in Prometheus text exposition format.
"""

import logging
from typing import Any

from app.core.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Process-local fallbacks (used when Redis is unavailable)
_local_counters: dict[str, float] = {}
_local_histograms: dict[str, list[float]] = {}

HISTOGRAM_BUCKETS = [0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0]


def inc_counter(name: str, value: float = 1.0, labels: dict[str, str] | None = None) -> None:
    key = _label_key(name, labels)
    client = get_redis_client()
    if client:
        try:
            client.incrbyfloat(f"metric:counter:{key}", value)
            return
        except Exception as exc:
            logger.debug("Redis counter write failed: %s", exc)
    _local_counters[key] = _local_counters.get(key, 0.0) + value


def observe_histogram(name: str, value: float, labels: dict[str, str] | None = None) -> None:
    key = _label_key(name, labels)
    client = get_redis_client()
    if client:
        try:
            client.rpush(f"metric:hist:{key}", str(value))
            client.ltrim(f"metric:hist:{key}", -1000, -1)
            return
        except Exception as exc:
            logger.debug("Redis histogram write failed: %s", exc)
    _local_histograms.setdefault(key, []).append(value)
    _local_histograms[key] = _local_histograms[key][-1000:]


def _label_key(name: str, labels: dict[str, str] | None) -> str:
    if not labels:
        return name
    parts = [f"{k}={v}" for k, v in sorted(labels.items())]
    return f"{name}__{'_'.join(parts)}"


def _get_counter(name: str, labels: dict[str, str] | None) -> float:
    key = _label_key(name, labels)
    client = get_redis_client()
    if client:
        try:
            val = client.get(f"metric:counter:{key}")
            return float(val) if val else 0.0
        except Exception:
            pass
    return _local_counters.get(key, 0.0)


def _get_histogram_values(name: str, labels: dict[str, str] | None) -> list[float]:
    key = _label_key(name, labels)
    client = get_redis_client()
    if client:
        try:
            raw = client.lrange(f"metric:hist:{key}", 0, -1)
            return [float(v) for v in raw]
        except Exception:
            pass
    return _local_histograms.get(key, [])


def render_prometheus() -> str:
    lines: list[str] = []

    metric_defs = [
        ("aigrafka_jobs_total", "counter", "Total jobs processed", ["status"]),
        ("aigrafka_generate_requests_total", "counter", "Total generate requests", ["outcome"]),
        ("aigrafka_generation_latency_seconds", "histogram", "Generation latency in seconds", ["model"]),
        ("aigrafka_gemini_calls_total", "counter", "Total Gemini API calls", ["model", "status"]),
        ("aigrafka_token_refunds_total", "counter", "Total token refunds", None),
    ]

    for name, mtype, help_text, label_names in metric_defs:
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} {mtype}")

        if mtype == "counter":
            if label_names:
                for label_combo in _iter_label_combos(name, label_names):
                    val = _get_counter(name, label_combo)
                    label_str = ",".join(f'{k}="{v}"' for k, v in sorted(label_combo.items()))
                    lines.append(f'{name}{{{label_str}}} {val}')
            else:
                val = _get_counter(name, None)
                lines.append(f"{name} {val}")

        elif mtype == "histogram":
            if label_names:
                for label_combo in _iter_label_combos(name, label_names):
                    _render_histogram_lines(lines, name, label_combo, _get_histogram_values(name, label_combo))
            else:
                _render_histogram_lines(lines, name, None, _get_histogram_values(name, None))

    lines.append("")
    return "\n".join(lines)


def _iter_label_combos(name: str, label_names: list[str]) -> list[dict[str, str]]:
    """Return known label combinations by scanning local and Redis keys."""
    combos: list[dict[str, str]] = []
    seen: set[str] = set()

    # Scan local
    for key in list(_local_counters.keys()) + list(_local_histograms.keys()):
        if key.startswith(name):
            labels = _parse_labels(key, name)
            combo_key = repr(sorted(labels.items()))
            if combo_key not in seen:
                seen.add(combo_key)
                combos.append(labels)

    # Scan Redis (SCAN, never KEYS, to avoid blocking the server)
    client = get_redis_client()
    if client:
        try:
            for prefix in ["metric:counter:", "metric:hist:"]:
                for k in _scan_keys(client, f"{prefix}{name}*"):
                    if isinstance(k, bytes):
                        k = k.decode()
                    bare = k.replace(prefix, "", 1)
                    labels = _parse_labels(bare, name)
                    combo_key = repr(sorted(labels.items()))
                    if combo_key not in seen:
                        seen.add(combo_key)
                        combos.append(labels)
        except Exception:
            pass

    return combos or [{}]


def _scan_keys(client, match: str) -> list:
    """Iterate keys via SCAN for both native redis and Upstash REST clients."""
    keys: list = []
    scan_iter = getattr(client, "scan_iter", None)
    if callable(scan_iter):
        keys.extend(scan_iter(match=match, count=200))
        return keys

    cursor = 0
    while True:
        cursor, batch = client.scan(cursor=cursor, match=match, count=200)
        keys.extend(batch)
        if not cursor or str(cursor) == "0":
            break
    return keys


def _parse_labels(key: str, name: str) -> dict[str, str]:
    if "__" not in key:
        return {}
    label_part = key.split("__", 1)[1]
    labels: dict[str, str] = {}
    for pair in label_part.split("_"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            labels[k] = v
    return labels


def _render_histogram_lines(
    lines: list[str], name: str, labels: dict[str, str] | None, values: list[float]
) -> None:
    label_str = ""
    if labels:
        label_str = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))

    count = len(values)
    total = sum(values)

    for bucket in HISTOGRAM_BUCKETS:
        bucket_count = sum(1 for v in values if v <= bucket)
        if label_str:
            lines.append(f'{name}_bucket{{le="{bucket}",{label_str}}} {bucket_count}')
        else:
            lines.append(f'{name}_bucket{{le="{bucket}"}} {bucket_count}')

    if label_str:
        lines.append(f'{name}_bucket{{le="+Inf",{label_str}}} {count}')
        lines.append(f'{name}_sum{{{label_str}}} {total}')
        lines.append(f'{name}_count{{{label_str}}} {count}')
    else:
        lines.append(f'{name}_bucket{{le="+Inf"}} {count}')
        lines.append(f'{name}_sum {total}')
        lines.append(f'{name}_count {count}')


def track_generation_latency(model: str, latency_seconds: float) -> None:
    observe_histogram("aigrafka_generation_latency_seconds", latency_seconds, {"model": model})


def track_job_status(status: str) -> None:
    inc_counter("aigrafka_jobs_total", 1.0, {"status": status})


def track_gemini_call(model: str, status: str) -> None:
    inc_counter("aigrafka_gemini_calls_total", 1.0, {"model": model, "status": status})


def track_generate_request(outcome: str) -> None:
    inc_counter("aigrafka_generate_requests_total", 1.0, {"outcome": outcome})


def track_token_refund() -> None:
    inc_counter("aigrafka_token_refunds_total", 1.0)


def setup_structured_logging(level: int = logging.INFO) -> None:
    """Configure JSON-structured logging for production observability."""

    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            import json

            log_entry: dict[str, Any] = {
                "timestamp": self.formatTime(record, self.datefmt),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            }
            if record.exc_info and record.exc_info[1]:
                log_entry["exception"] = str(record.exc_info[1])
            if hasattr(record, "job_id"):
                log_entry["job_id"] = record.job_id
            if hasattr(record, "model"):
                log_entry["model"] = record.model
            return json.dumps(log_entry, ensure_ascii=False)

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
