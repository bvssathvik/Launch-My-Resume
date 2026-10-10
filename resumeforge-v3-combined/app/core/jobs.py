"""Job registry — generation_id state machine + idempotency.

Direct port of jobs-registry.ts. One record per generation_id; each phase
transitions PENDING -> RUNNING -> COMPLETED | FAILED. Semantics:

  - job COMPLETED  -> replay the stored result, run nothing.
  - job RUNNING    -> reject (409) — stops double-clicks / duplicate submits.
  - job FAILED     -> user explicitly retried; allow a fresh run.
  - stale RUNNING  -> no update for RUNNING_STALE_MS -> allow fresh run.
  - no record      -> fresh run.

Persistence: in-memory dict always; optionally mirrored to a JSON file so
idempotency survives restarts. Writes are atomic (tmp file + rename) and
best-effort — a store failure degrades to in-process only, never crashes
the pipeline.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from typing import Any, Optional

RUNNING_STALE_MS = 4 * 60 * 1000  # a RUNNING job with no update in 4 min is crashed

PHASE_STATUSES = ("PENDING", "RUNNING", "COMPLETED", "FAILED")
JOB_STATUSES = ("RUNNING", "COMPLETED", "FAILED")


def new_job(generation_id: str) -> dict:
    now = int(time.time() * 1000)
    # NOTE: phase keys are strings so the record stays identical across the
    # in-memory store and the JSON-file store (json round-trips int keys to str).
    return {
        "generation_id": generation_id,
        "status": "RUNNING",
        "phases": {
            "1": {"status": "PENDING"},
            "2": {"status": "PENDING"},
            "3": {"status": "PENDING"},
            "4": {"status": "PENDING"},
        },
        "created_at": now,
        "updated_at": now,
    }


def classify_existing(job: Optional[dict]) -> str:
    """fresh | replay | in_progress | retry_failed"""
    if not job:
        return "fresh"
    if job.get("status") == "COMPLETED":
        return "replay"
    now = int(time.time() * 1000)
    if job.get("status") == "RUNNING" and now - job.get("updated_at", 0) < RUNNING_STALE_MS:
        return "in_progress"
    return "retry_failed"


class JobRegistry:
    def __init__(
        self,
        store_path: Optional[str] = None,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        supabase_table: str = "generation_jobs",
    ) -> None:
        self._store: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._path = store_path or None
        self._supabase_url = (supabase_url or "").rstrip("/")
        self._supabase_key = supabase_key or ""
        self._supabase_table = supabase_table or "generation_jobs"
        if self._path:
            self._load()

    def _load(self) -> None:
        try:
            if self._path and os.path.exists(self._path):
                with open(self._path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    self._store.update(data)
        except Exception as exc:  # noqa: BLE001 — best-effort only
            print(f"jobs-registry: store load failed (starting empty): {exc}")

    def _persist(self) -> None:
        if not self._path:
            return
        try:
            os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self._path) or ".", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(self._store, fh)
                os.replace(tmp, self._path)
            except Exception:
                if os.path.exists(tmp):
                    os.unlink(tmp)
                raise
        except Exception as exc:  # noqa: BLE001
            print(f"jobs-registry: store save failed (in-memory only): {exc}")

    def _save_supabase(self, job: dict) -> None:
        if not (self._supabase_url and self._supabase_key):
            return
        try:
            import httpx

            url = f"{self._supabase_url}/rest/v1/{self._supabase_table}"
            headers = {
                "apikey": self._supabase_key,
                "Authorization": f"Bearer {self._supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            }
            payload = {
                "generation_id": job["generation_id"],
                "record": job,
            }
            with httpx.Client(timeout=4.0) as client:
                client.post(url, headers=headers, json=payload)
        except Exception as exc:  # noqa: BLE001
            print(f"jobs-registry: Supabase save failed: {exc}")

    def _load_supabase(self, generation_id: str) -> Optional[dict]:
        if not (self._supabase_url and self._supabase_key):
            return None
        try:
            import httpx

            url = f"{self._supabase_url}/rest/v1/{self._supabase_table}"
            headers = {
                "apikey": self._supabase_key,
                "Authorization": f"Bearer {self._supabase_key}",
            }
            params = {
                "generation_id": f"eq.{generation_id}",
                "select": "record",
            }
            with httpx.Client(timeout=4.0) as client:
                res = client.get(url, headers=headers, params=params)
                if res.status_code == 200:
                    rows = res.json()
                    if rows and isinstance(rows, list):
                        record = rows[0].get("record")
                        if isinstance(record, dict):
                            return record
        except Exception as exc:  # noqa: BLE001
            print(f"jobs-registry: Supabase load failed: {exc}")
        return None

    def load(self, generation_id: str) -> Optional[dict]:
        with self._lock:
            cached = self._store.get(generation_id)
            if cached:
                return cached
        if self._supabase_url and self._supabase_key:
            remote = self._load_supabase(generation_id)
            if remote:
                with self._lock:
                    self._store[generation_id] = remote
                return remote
        return None

    def save(self, job: dict) -> None:
        with self._lock:
            self._store[job["generation_id"]] = job
            self._persist()
        if self._supabase_url and self._supabase_key:
            self._save_supabase(job)

    def all(self) -> dict:
        with self._lock:
            return dict(self._store)
