#!/usr/bin/env python3
"""Iron Precinct server — serves the game files and relays two-player messages.

Python standard library only. Run from anywhere:

    python3 server.py                 # 127.0.0.1 + this machine's Tailscale IP, port 8137
    python3 server.py --host 0.0.0.0  # every interface (use with care)

WebSocket protocol on /ws (JSON text frames, every message has "t"):
  server -> client: welcome{slot}, full, lobby{players,mode,phase}, start{mode,seed}, left{slot}
  client -> server: mode{mode} (slot 1), start (slot 1, both present), end (either)
  anything else is forwarded verbatim to the other player.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import struct
import subprocess
import sys
from urllib.parse import unquote, urlsplit

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1 << 20  # 1 MiB
MODES = ("coop", "versus")
HERE = os.path.dirname(os.path.abspath(__file__))

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/html", ".html")


def log(*args):
    print("[iron-precinct]", *args, flush=True)


class ProtocolError(Exception):
    pass


class WSConn:
    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.lock = asyncio.Lock()
        self.closed = False
        self.last_seen = asyncio.get_running_loop().time()

    async def send_frame(self, opcode, payload: bytes):
        if self.closed:
            return
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            header = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        async with self.lock:
            try:
                self.writer.write(header + payload)
                await self.writer.drain()
            except (ConnectionError, RuntimeError):
                self.closed = True

    async def send(self, obj):
        await self.send_frame(1, json.dumps(obj, separators=(",", ":")).encode())

    async def recv(self):
        b0, b1 = await self.reader.readexactly(2)
        if not b0 & 0x80:
            raise ProtocolError("fragmented frames not supported")
        if not b1 & 0x80:
            raise ProtocolError("client frames must be masked")
        opcode, n = b0 & 0x0F, b1 & 0x7F
        if n == 126:
            (n,) = struct.unpack("!H", await self.reader.readexactly(2))
        elif n == 127:
            (n,) = struct.unpack("!Q", await self.reader.readexactly(8))
        if n > MAX_FRAME:
            raise ProtocolError("frame too large")
        mask = await self.reader.readexactly(4)
        data = await self.reader.readexactly(n)
        self.last_seen = asyncio.get_running_loop().time()
        if n:
            key = (mask * (n // 4 + 1))[:n]
            data = (int.from_bytes(data, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")
        return opcode, data

    async def close(self, code=1000):
        if not self.closed:
            await self.send_frame(8, struct.pack("!H", code))
        self.closed = True
        try:
            self.writer.close()
        except RuntimeError:
            pass


class Lobby:
    def __init__(self):
        self.slots = {1: None, 2: None}
        self.mode = "coop"
        self.phase = "lobby"

    def join(self, conn):
        for slot in (1, 2):
            if self.slots[slot] is None:
                self.slots[slot] = conn
                return slot
        return None

    def state(self):
        return {
            "t": "lobby",
            "players": [self.slots[1] is not None, self.slots[2] is not None],
            "mode": self.mode,
            "phase": self.phase,
        }

    async def broadcast(self, obj):
        for conn in list(self.slots.values()):
            if conn is not None:
                await conn.send(obj)

    async def handle(self, slot, payload: bytes):
        try:
            msg = json.loads(payload)
        except (ValueError, UnicodeDecodeError):
            raise ProtocolError("invalid JSON")
        if not isinstance(msg, dict) or not isinstance(msg.get("t"), str):
            raise ProtocolError("message must be an object with a string 't'")
        t = msg["t"]
        if t == "mode":
            if slot == 1 and msg.get("mode") in MODES and self.phase == "lobby":
                self.mode = msg["mode"]
                await self.broadcast(self.state())
        elif t == "start":
            if slot == 1 and self.phase == "lobby" and all(self.slots.values()):
                self.phase = "playing"
                log(f"match started: {self.mode}")
                await self.broadcast({"t": "start", "mode": self.mode, "seed": random.randint(1, 2**31 - 1)})
                await self.broadcast(self.state())
        elif t == "end":
            if self.phase != "lobby":
                self.phase = "lobby"
                await self.broadcast(self.state())
        else:
            other = self.slots[2 if slot == 1 else 1]
            if other is not None:
                await other.send_frame(1, payload)

    async def leave(self, slot):
        self.slots[slot] = None
        self.phase = "lobby"
        log(f"player {slot} left")
        await self.broadcast({"t": "left", "slot": slot})
        await self.broadcast(self.state())


async def heartbeat(conn, slot, ping_interval, idle_timeout):
    """Ping the browser regularly; drop it if it goes silent (lid closed, wifi gone, process killed).
    Browsers answer pings automatically, so a live tab is never dropped."""
    loop = asyncio.get_running_loop()
    while not conn.closed:
        await asyncio.sleep(ping_interval)
        if loop.time() - conn.last_seen > idle_timeout:
            log(f"player {slot} timed out")
            conn.writer.transport.abort()  # wakes the reader loop, which frees the slot
            return
        await conn.send_frame(9, b"hb")


async def handle_ws(reader, writer, headers, lobby, ping_interval, idle_timeout):
    key = headers.get("sec-websocket-key")
    if not key:
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        writer.close()
        return
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(
        (
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode()
    )
    await writer.drain()
    conn = WSConn(reader, writer)
    slot = lobby.join(conn)
    if slot is None:
        log("connection refused: game full")
        await conn.send({"t": "full"})
        await conn.close()
        return
    log(f"player {slot} joined")
    await conn.send({"t": "welcome", "slot": slot})
    await lobby.broadcast(lobby.state())
    code = 1000
    beat = asyncio.ensure_future(heartbeat(conn, slot, ping_interval, idle_timeout))
    try:
        while True:
            opcode, payload = await conn.recv()
            if opcode == 8:
                break
            if opcode == 9:
                await conn.send_frame(10, payload)
            elif opcode == 10:
                continue
            elif opcode == 1:
                await lobby.handle(slot, payload)
            else:
                raise ProtocolError(f"unsupported opcode {opcode}")
    except ProtocolError as e:
        log(f"player {slot} dropped: {e}")
        code = 1003
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        beat.cancel()
        if lobby.slots.get(slot) is conn:
            await lobby.leave(slot)
        await conn.close(code)


async def serve_static(writer, root, path, method):
    rel = unquote(path).lstrip("/")
    real_root = os.path.realpath(root)
    full = os.path.realpath(os.path.join(real_root, rel))
    if full != real_root and not full.startswith(real_root + os.sep):
        full = None
    elif os.path.isdir(full):
        full = os.path.join(full, "index.html")
    if method not in ("GET", "HEAD") or full is None or not os.path.isfile(full):
        body = b"Not found"
        writer.write(
            b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n"
            % len(body) + body
        )
    else:
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/"):
            ctype += "; charset=utf-8"
        head = (
            f"HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
            "Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
        ).encode()
        writer.write(head + (body if method == "GET" else b""))
    try:
        await writer.drain()
    finally:
        writer.close()


async def handle_client(reader, writer, root, lobby, ping_interval, idle_timeout):
    try:
        request = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        lines = request.decode("latin-1").split("\r\n")
        method, target, _ = lines[0].split(" ", 2)
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        path = urlsplit(target).path
        if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
            await handle_ws(reader, writer, headers, lobby, ping_interval, idle_timeout)
        else:
            await serve_static(writer, root, path, method)
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ValueError, ConnectionError):
        writer.close()


async def serve(root, hosts, port, ping_interval=5.0, idle_timeout=15.0):
    """Start listening on each host. Returns the asyncio servers (already serving)."""
    lobby = Lobby()
    servers = []
    for host in hosts:
        servers.append(await asyncio.start_server(
            lambda r, w: handle_client(r, w, root, lobby, ping_interval, idle_timeout), host, port))
    return servers


def tailscale_ip():
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=3)
        ip = out.stdout.strip().splitlines()[0] if out.returncode == 0 and out.stdout.strip() else None
        return ip
    except (OSError, subprocess.SubprocessError, IndexError):
        return None


def main():
    ap = argparse.ArgumentParser(description="Iron Precinct game server")
    ap.add_argument("--host", action="append", help="address to bind (repeatable). Default: 127.0.0.1 + Tailscale IP")
    ap.add_argument("--port", type=int, default=8137)
    ap.add_argument("--root", default=HERE, help="directory to serve (default: this folder)")
    args = ap.parse_args()
    hosts = args.host or ["127.0.0.1"] + ([ip] if (ip := tailscale_ip()) else [])

    async def run():
        await serve(args.root, hosts, args.port)
        for h in hosts:
            log(f"serving http://{h}:{args.port}/")
        await asyncio.Event().wait()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
