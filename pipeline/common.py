"""Shared paths and compact, deterministic on-disk records."""
from datetime import datetime, timezone
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'web/public/data'
CURATED = ROOT / 'data/curated'
PROCESSED = ROOT / 'data/processed'
RAW = ROOT / 'data/raw'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False), encoding='utf-8')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def iso(value):
    return value.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
