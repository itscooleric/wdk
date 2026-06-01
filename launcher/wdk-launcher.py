#!/usr/bin/env python3
"""
WDK Launcher — Python variant.

Reads sites.json, opens Chrome to each configured URL, prints a per-site
checklist for the user (which DevTools Recorder JSON to run, or which
bookmarklet to paste). Optionally starts a folder watcher that fires the
transfer pipeline (`transfer.after_drop`) when new files land in the
outbox.

No external dependencies. Stdlib only — runs on Python 3.8+ in
restricted/air-gapped environments where pip is unavailable.

Usage:
    python wdk-launcher.py [--config sites.json] [--watch] [--no-open]

Examples:
    python wdk-launcher.py
    python wdk-launcher.py --config my-sites.json --watch
    python wdk-launcher.py --no-open --watch     # only watcher
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Dict, Iterable, List, Optional


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"[error] config not found: {path}")
    with path.open(encoding="utf-8") as f:
        try:
            cfg = json.load(f)
        except json.JSONDecodeError as e:
            sys.exit(f"[error] invalid JSON in {path}: {e}")
    if cfg.get("version") != "1":
        sys.exit(f"[error] unsupported sites.json version: {cfg.get('version')}")
    sites = cfg.get("sites") or []
    if not isinstance(sites, list) or not sites:
        sys.exit("[error] sites.json has no sites")
    return cfg


# ---------------------------------------------------------------------------
# Chrome / browser open
# ---------------------------------------------------------------------------

def find_chrome() -> Optional[str]:
    """Return the path to a Chrome-family browser, or None."""
    candidates = [
        os.environ.get("CHROME_PATH"),
        "google-chrome",
        "chrome",
        "chromium",
        "msedge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if not c:
            continue
        if os.path.isabs(c) and os.path.exists(c):
            return c
        which = shutil.which(c)
        if which:
            return which
    return None


def open_sites(sites: List[dict]) -> None:
    """Open each site URL in a Chrome tab, falling back to webbrowser."""
    chrome = find_chrome()
    urls = [s["url"] for s in sites if s.get("url")]
    if not urls:
        print("[warn] no URLs to open")
        return
    if chrome:
        try:
            subprocess.Popen([chrome, *urls], close_fds=True)
            print(f"[ok] opened {len(urls)} tab(s) in {os.path.basename(chrome)}")
            return
        except OSError as e:
            print(f"[warn] failed to launch chrome ({e}); falling back to webbrowser")
    for url in urls:
        webbrowser.open_new_tab(url)
    print(f"[ok] opened {len(urls)} tab(s) via default browser")


# ---------------------------------------------------------------------------
# Per-site checklist printer
# ---------------------------------------------------------------------------

METHOD_INSTRUCTIONS = {
    "bookmarklet":         "Paste the bookmarklet from {bookmarklet_file} into the address bar and run it. The response will download to your default downloads folder.",
    "wdk-bookmarklet":     "Open the WDK loader bookmarklet from {bookmarklet_file}. WDK appears as a panel; use Network or Automator tab.",
    "devtools-recorder":   "Open DevTools (F12) > Recorder tab > Import {recorder_file} > click Replay. Output drops to default downloads.",
    "manual":              "Manual operator steps; see the site description.",
}


def print_checklist(cfg: dict) -> None:
    sites = cfg["sites"]
    outbox = cfg.get("outbox", "./outbox")
    width = max(len(s["name"]) for s in sites)
    print("\n" + "=" * 64)
    print(f"  WDK Launcher — {len(sites)} site(s)")
    print(f"  Outbox: {outbox}")
    print("=" * 64)
    for i, s in enumerate(sites, 1):
        name = s["name"].ljust(width)
        method = s.get("method", "manual")
        print(f"\n  [{i}] {name}   method={method}")
        print(f"      url:  {s['url']}")
        if s.get("description"):
            print(f"      note: {s['description']}")
        instr = METHOD_INSTRUCTIONS.get(method, "(unknown method)")
        try:
            instr = instr.format(**s)
        except KeyError:
            pass
        print(f"      step: {instr}")
        if s.get("filename_hint"):
            print(f"      drop: move/save to {outbox}/{s['filename_hint']}")
    print("\n" + "-" * 64)
    print("  When all downloads are in the outbox, the watcher (if running)")
    print("  will fire the transfer pipeline automatically. Ctrl+C to exit.")
    print("-" * 64 + "\n")


# ---------------------------------------------------------------------------
# Folder watcher (D.4)
# ---------------------------------------------------------------------------

class OutboxWatcher:
    """Polls a directory and fires `after_drop` when new files appear."""

    def __init__(self, outbox: Path, after_drop: Optional[str], poll_seconds: float = 2.0):
        self.outbox = outbox
        self.after_drop = after_drop
        self.poll_seconds = poll_seconds
        self._stop = threading.Event()
        self._known: Dict[str, int] = {}    # name -> mtime

    def start(self) -> None:
        self.outbox.mkdir(parents=True, exist_ok=True)
        # Seed known files so we don't fire on startup
        for f in self.outbox.iterdir():
            if f.is_file():
                self._known[f.name] = int(f.stat().st_mtime)
        print(f"[watcher] watching {self.outbox} (poll={self.poll_seconds}s)")
        if not self.after_drop:
            print("[watcher] no transfer.after_drop configured — will only log new files")
        try:
            while not self._stop.is_set():
                self._tick()
                self._stop.wait(self.poll_seconds)
        except KeyboardInterrupt:
            pass
        print("[watcher] stopped")

    def stop(self) -> None:
        self._stop.set()

    def _tick(self) -> None:
        new_files: List[Path] = []
        try:
            entries = list(self.outbox.iterdir())
        except OSError:
            return
        for f in entries:
            if not f.is_file():
                continue
            mtime = int(f.stat().st_mtime)
            if f.name not in self._known or self._known[f.name] != mtime:
                new_files.append(f)
                self._known[f.name] = mtime
        if new_files:
            for f in new_files:
                print(f"[watcher] new: {f.name} ({f.stat().st_size}B)")
            if self.after_drop:
                self._fire_transfer(new_files)

    def _fire_transfer(self, files: Iterable[Path]) -> None:
        cmd = self.after_drop
        try:
            print(f"[watcher] firing: {cmd}")
            rc = subprocess.call(cmd, shell=True, cwd=str(self.outbox.parent))
            if rc == 0:
                print(f"[watcher] transfer ok")
            else:
                print(f"[watcher] transfer exit {rc}")
        except Exception as e:
            print(f"[watcher] transfer failed: {e}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="sites.json", help="Path to sites.json")
    ap.add_argument("--watch", action="store_true", help="Start folder watcher")
    ap.add_argument("--no-open", action="store_true", help="Skip opening browser tabs")
    ap.add_argument("--poll", type=float, default=2.0, help="Watcher poll interval (s)")
    args = ap.parse_args()

    cfg_path = Path(args.config).resolve()
    cfg = load_config(cfg_path)

    print_checklist(cfg)

    if not args.no_open:
        open_sites(cfg["sites"])

    if args.watch:
        outbox = Path(cfg.get("outbox", "./outbox")).resolve()
        transfer = cfg.get("transfer") or {}
        watcher = OutboxWatcher(outbox, transfer.get("after_drop"), args.poll)
        watcher.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
