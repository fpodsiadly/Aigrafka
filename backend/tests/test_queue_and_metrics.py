from types import SimpleNamespace

from app.core.metrics import _label_key, _parse_labels, render_prometheus
from app.core.queue import PROCESSING_QUEUE_KEY, QUEUE_KEY, acknowledge_job, dequeue_job, recover_stale_jobs


class FakeRedis:
    def __init__(self):
        self.lists: dict[str, list[str]] = {}
        self.hashes: dict[str, dict[str, str]] = {}

    def blmove(self, source, destination, _timeout, _src, _dest):
        return self.lmove(source, destination)

    def lmove(self, source, destination, _src="LEFT", _dest="RIGHT"):
        if not self.lists.get(source):
            return None
        item = self.lists[source].pop(0)
        self.lists.setdefault(destination, []).append(item)
        return item

    def lrem(self, key, _count, value):
        items = self.lists.get(key, [])
        if value not in items:
            return 0
        items.remove(value)
        return 1

    def lrange(self, key, _start, _end):
        return list(self.lists.get(key, []))

    def lpush(self, key, value):
        self.lists.setdefault(key, []).insert(0, value)

    def hgetall(self, key):
        return self.hashes.get(key, {})

    def hset(self, key, mapping=None, values=None):
        self.hashes.setdefault(key, {}).update(mapping or values or {})


def test_queue_moves_acknowledges_and_recovers_stale_job(monkeypatch):
    import app.core.queue as queue

    redis = FakeRedis()
    redis.lists[QUEUE_KEY] = ["job-1"]
    redis.hashes["job:job-1"] = {"started_at": "1", "status": "running"}
    monkeypatch.setattr(queue, "get_redis_client", lambda: redis)
    monkeypatch.setattr(queue, "get_settings", lambda: SimpleNamespace(job_visibility_timeout_seconds=10))
    monkeypatch.setattr(queue.time, "time", lambda: 20)

    assert dequeue_job(timeout=1) == "job-1"
    assert redis.lists[PROCESSING_QUEUE_KEY] == ["job-1"]
    assert recover_stale_jobs() == 1
    assert redis.lists[QUEUE_KEY] == ["job-1"]
    assert redis.hashes["job:job-1"]["status"] == "pending"

    assert dequeue_job(timeout=1) == "job-1"
    acknowledge_job("job-1")
    assert redis.lists[PROCESSING_QUEUE_KEY] == []


def test_metrics_labels_round_trip_and_escape_output():
    labels = {"model": 'model_"quoted"\\newline\n'}
    key = _label_key("aigrafka_generation_latency_seconds", labels)
    assert _parse_labels(key, "aigrafka_generation_latency_seconds") == labels

    import app.core.metrics as metrics

    metrics._local_counters.clear()
    metrics.inc_counter("aigrafka_jobs_total", labels={"status": 'done"\\\n'})
    output = render_prometheus()
    assert 'status="done\\"\\\\\\n"' in output
