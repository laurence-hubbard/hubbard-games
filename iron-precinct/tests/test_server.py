"""Tests for server.py: static file serving + WebSocket lobby relay.

Run from iron-precinct/:  python3 -m unittest tests.test_server -v
"""
import asyncio
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import server  # noqa: E402

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class Closed(Exception):
    pass


class WS:
    """Minimal blocking WebSocket client (masked frames, as browsers send)."""

    def __init__(self, port):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=2)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(
            (
                "GET /ws HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.s.recv(4096)
            if not chunk:
                raise Closed("closed during handshake")
            data += chunk
        head, self.buf = data.split(b"\r\n\r\n", 1)
        lines = head.decode().split("\r\n")
        assert " 101 " in lines[0], lines[0]
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        headers = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in lines[1:]}
        assert headers["sec-websocket-accept"] == expected

    def send_frame(self, opcode, payload, length_override=None):
        n = len(payload) if length_override is None else length_override
        hdr = bytes([0x80 | opcode])
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack("!H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.s.sendall(hdr + mask + body)

    def send(self, obj):
        self.send_frame(1, json.dumps(obj).encode())

    def _read(self, n, deadline):
        while len(self.buf) < n:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise socket.timeout()
            self.s.settimeout(remaining)
            try:
                chunk = self.s.recv(65536)
            except ConnectionResetError:
                raise Closed("reset")
            if not chunk:
                raise Closed("eof")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv_frame(self, timeout=2.0):
        deadline = time.time() + timeout
        b0, b1 = self._read(2, deadline)
        n = b1 & 0x7F
        if n == 126:
            (n,) = struct.unpack("!H", self._read(2, deadline))
        elif n == 127:
            (n,) = struct.unpack("!Q", self._read(8, deadline))
        assert not (b1 & 0x80), "server frames must not be masked"
        return b0 & 0x0F, self._read(n, deadline)

    def recv(self, timeout=2.0):
        """Next JSON message. Raises Closed on close frame / EOF, socket.timeout on timeout."""
        deadline = time.time() + timeout
        while True:
            op, payload = self.recv_frame(max(0.01, deadline - time.time()))
            if op == 1:
                return json.loads(payload)
            if op == 8:
                raise Closed("close frame")

    def recv_until(self, t, timeout=2.0):
        deadline = time.time() + timeout
        while True:
            msg = self.recv(max(0.01, deadline - time.time()))
            if msg.get("t") == t:
                return msg

    def expect_no(self, t, timeout=0.3):
        deadline = time.time() + timeout
        try:
            while True:
                msg = self.recv(max(0.01, deadline - time.time()))
                if msg.get("t") == t:
                    raise AssertionError(f"unexpected {t}: {msg}")
        except socket.timeout:
            return

    def is_closed(self, timeout=2.0):
        deadline = time.time() + timeout
        try:
            while True:
                self.recv(max(0.01, deadline - time.time()))
        except Closed:
            return True
        except socket.timeout:
            return False

    def close(self):
        try:
            self.send_frame(8, b"")
        except OSError:
            pass
        self.s.close()


def http_get(port, path):
    s = socket.create_connection(("127.0.0.1", port), timeout=2)
    s.sendall(f"GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n".encode())
    data = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        data += chunk
    s.close()
    head, body = data.split(b"\r\n\r\n", 1)
    lines = head.decode().split("\r\n")
    status = int(lines[0].split()[1])
    headers = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in lines[1:]}
    return status, headers, body


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        servers = asyncio.run_coroutine_threadsafe(server.serve(ROOT, ["127.0.0.1"], 0), self.loop).result(5)
        self.servers = servers
        self.port = servers[0].sockets[0].getsockname()[1]
        self.clients = []

    def tearDown(self):
        for c in self.clients:
            try:
                c.s.close()
            except OSError:
                pass

        async def stop():
            for s in self.servers:
                s.close()

        try:
            asyncio.run_coroutine_threadsafe(stop(), self.loop).result(3)
        except Exception:
            pass
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(3)

    def join(self):
        c = WS(self.port)
        self.clients.append(c)
        return c

    def two_players(self):
        p1 = self.join()
        self.assertEqual(p1.recv_until("welcome")["slot"], 1)
        p2 = self.join()
        self.assertEqual(p2.recv_until("welcome")["slot"], 2)
        return p1, p2

    # --- static files -----------------------------------------------------

    def test_static_serves_index(self):
        status, headers, body = http_get(self.port, "/")
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("text/html"))
        self.assertIn(b"IRON PRECINCT", body)

    def test_js_mime_type(self):
        status, headers, _ = http_get(self.port, "/src/main.js")
        self.assertEqual(status, 200)
        self.assertTrue(headers["content-type"].startswith("text/javascript"), headers["content-type"])

    def test_path_traversal_blocked(self):
        for path in ["/../server.py", "/%2e%2e/server.py", "/src/../../README.md", "/%2e%2e/%2e%2e/etc/passwd"]:
            status, _, _ = http_get(self.port, path)
            self.assertEqual(status, 404, path)

    # --- lobby --------------------------------------------------------------

    def test_first_two_get_slots_third_full(self):
        self.two_players()
        p3 = self.join()
        self.assertEqual(p3.recv()["t"], "full")
        self.assertTrue(p3.is_closed())

    def test_lobby_broadcast_on_join(self):
        p1, p2 = self.two_players()
        for c in (p1, p2):
            lobby = c.recv_until("lobby")
            while lobby["players"] != [True, True]:
                lobby = c.recv_until("lobby")
            self.assertEqual(lobby["phase"], "lobby")
            self.assertEqual(lobby["mode"], "coop")

    def test_only_p1_sets_mode_and_starts(self):
        p1, p2 = self.two_players()
        p2.send({"t": "mode", "mode": "versus"})
        p2.send({"t": "start"})
        p1.expect_no("start")
        p1.send({"t": "mode", "mode": "versus"})
        lobby = p2.recv_until("lobby")
        while lobby["mode"] != "versus":
            lobby = p2.recv_until("lobby")
        p1.send({"t": "start"})
        for c in (p1, p2):
            msg = c.recv_until("start")
            self.assertEqual(msg["mode"], "versus")
            self.assertIsInstance(msg["seed"], int)

    def test_invalid_mode_ignored(self):
        p1, p2 = self.two_players()
        p1.send({"t": "mode", "mode": "battle-royale"})
        p1.send({"t": "start"})
        self.assertEqual(p2.recv_until("start")["mode"], "coop")

    def test_start_requires_two_players(self):
        p1 = self.join()
        p1.recv_until("welcome")
        p1.send({"t": "start"})
        p1.expect_no("start")

    def test_relay_forwards_other_messages(self):
        p1, p2 = self.two_players()
        p2.send({"t": "input", "x": 1})
        self.assertEqual(p1.recv_until("input"), {"t": "input", "x": 1})
        p1.send({"t": "snap", "players": [1, 2]})
        self.assertEqual(p2.recv_until("snap"), {"t": "snap", "players": [1, 2]})
        p1.expect_no("snap")
        p2.expect_no("input")

    def test_disconnect_notifies_and_resets(self):
        p1, p2 = self.two_players()
        p1.send({"t": "start"})
        p1.recv_until("start")
        p2.close()
        self.assertEqual(p1.recv_until("left")["slot"], 2)
        lobby = p1.recv_until("lobby")
        self.assertEqual(lobby["phase"], "lobby")
        self.assertEqual(lobby["players"], [True, False])

    def test_end_returns_to_lobby(self):
        p1, p2 = self.two_players()
        p1.send({"t": "start"})
        p2.recv_until("start")
        p2.send({"t": "end"})
        lobby = p1.recv_until("lobby")
        while lobby["phase"] != "lobby" or lobby["players"] != [True, True]:
            lobby = p1.recv_until("lobby")

    def test_reconnect_after_disconnect_gets_slot(self):
        p1, p2 = self.two_players()
        p2.close()
        p1.recv_until("left")
        p3 = self.join()
        self.assertEqual(p3.recv_until("welcome")["slot"], 2)

    def test_garbage_frame_drops_only_sender(self):
        for bad in ("binary", "json", "huge"):
            with self.subTest(bad=bad):
                p1, p2 = self.two_players()
                if bad == "binary":
                    p2.send_frame(2, b"\x00\x01\x02")
                elif bad == "json":
                    p2.send_frame(1, b"{not json")
                else:
                    p2.send_frame(1, b"x" * 16, length_override=2 * 1024 * 1024)
                self.assertTrue(p2.is_closed(), "sender should be dropped")
                p1.recv_until("left")
                p1.send({"t": "mode", "mode": "versus"})
                lobby = p1.recv_until("lobby")
                while lobby["mode"] != "versus":
                    lobby = p1.recv_until("lobby")
                p3 = self.join()
                self.assertEqual(p3.recv_until("welcome")["slot"], 2)
                # reset for next subtest
                p1.close()
                p3.close()
                time.sleep(0.15)

    def test_ping_gets_pong(self):
        p1 = self.join()
        p1.recv_until("welcome")
        p1.send_frame(9, b"hi")
        deadline = time.time() + 2
        while True:
            op, payload = p1.recv_frame(max(0.01, deadline - time.time()))
            if op == 10:
                self.assertEqual(payload, b"hi")
                break


if __name__ == "__main__":
    unittest.main()
