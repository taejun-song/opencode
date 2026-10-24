#!/usr/bin/env python3
"""Stub airlock security center for the engine's CI self-test (feature 012).

  stub-center.py --port N --mode allow|deny|unauth|hang [--record FILE]

POST /v1/check  -> verdict per --mode (hang: sleep 25s, then allow)
POST /v1/events -> {"accepted": n, "ids": [...]}
GET  /v1/health -> {"status": "ok"}
Every request body is appended to --record as one JSON line: {"path": ..., "body": ...}.
"""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

ARGS = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self, body):
        if ARGS.record:
            with open(ARGS.record, "a") as f:
                f.write(json.dumps({"path": self.path, "body": body}) + "\n")

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/v1/health":
            self._json(200, {"status": "ok", "version": "stub", "rules_enabled": 1})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            body = {"_raw": raw.decode(errors="replace")}
        self._record(body)
        p = self.path.rstrip("/")
        if p == "/v1/events":
            n = len(body.get("events", [])) if isinstance(body, dict) else 0
            self._json(200, {"accepted": n, "ids": ["01STUBEV%04d" % i for i in range(n)]})
            return
        if p != "/v1/check":
            self._json(404, {"error": "not found"})
            return
        mode = ARGS.mode
        if mode == "unauth":
            self._json(401, {"error": "unauthorized"})
            return
        if mode == "hang":
            time.sleep(25)
            mode = "allow"
        if mode == "deny":
            self._json(200, {"verdict": "deny", "rule_id": "r1", "rule_name": "stub-rule",
                             "message": "stub message", "event_id": "01STUB"})
            return
        self._json(200, {"verdict": "allow", "event_id": "01STUB"})


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--mode", choices=["allow", "deny", "unauth", "hang"], default="allow")
    ap.add_argument("--record", default="")
    ARGS = ap.parse_args()
    HTTPServer((ARGS.host, ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
