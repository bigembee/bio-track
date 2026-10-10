#!/usr/bin/env python3
"""
Bio Track - development server
---------------------------------------------------------------
Python's plain http.server lets the browser cache aggressively, so an
edited .js or .css file keeps serving from memory and you debug code
that is no longer on disk. This is the same static server with caching
turned off.

    python tools/devserver.py [port]      # default 5173

Nothing here is needed in production - any static host will do.
"""
import functools
import http.server
import os
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_response(self, *args, **kwargs):
        # Never answer 304: the browser must take the bytes on disk.
        super().send_response(*args, **kwargs)

    def log_message(self, fmt, *args):
        if '200' not in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(ROOT)
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with Server(('127.0.0.1', PORT), handler) as httpd:
        print('Bio Track dev server (no cache) -> http://localhost:%d/' % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
