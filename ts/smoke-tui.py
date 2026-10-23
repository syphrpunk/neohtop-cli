#!/usr/bin/env python3
"""Start a compiled sloppytop on a pty, wait until it draws, send q, require exit 0.

Uses a temporary XDG_CONFIG_HOME so the user's config is left alone.
The screen buffer is not printed. A short failure message is printed when the
process exits before it draws.
"""

import fcntl
import os
import pty
import select
import struct
import sys
import tempfile
import termios
import time


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: smoke-tui.py <sloppytop-binary>", file=sys.stderr)
        return 2
    binary = os.path.abspath(sys.argv[1])
    if not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        print(f"missing binary: {binary}", file=sys.stderr)
        return 2

    os.environ["XDG_CONFIG_HOME"] = tempfile.mkdtemp(prefix="sloppytop-smoke-")
    os.environ["TERM"] = "xterm-256color"
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        os.execv(binary, [binary, "tui"])

    captured = bytearray()
    sent_q = False
    answered = 0
    start = time.time()
    exit_status = None
    try:
        while time.time() - start < 20:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if ready:
                try:
                    chunk = os.read(fd, 8192)
                except OSError:
                    chunk = b""
                if chunk:
                    captured.extend(chunk)
                elif sent_q:
                    break
            pending = captured.count(b"[6n")
            while answered < pending:
                try:
                    os.write(fd, b"\x1b[24;80R")
                except OSError:
                    break
                answered += 1
            if not sent_q and b"PID" in captured:
                try:
                    os.write(fd, b"q")
                    sent_q = True
                except OSError:
                    break
            waited, raw = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                exit_status = raw
                break
        if exit_status is None:
            try:
                os.write(fd, b"\x03")
            except OSError:
                pass
            time.sleep(1)
            waited, raw = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                exit_status = raw
            else:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
                note(captured)
                print("tui smoke: process did not exit", file=sys.stderr)
                return 1
        return finish(exit_status, captured, sent_q)
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def finish(status: int, captured: bytearray, sent_q: bool) -> int:
    code = os.waitstatus_to_exitcode(status)
    drew = b"PID" in captured and b"sloppytop" in captured
    if code == 0 and sent_q and drew:
        print(f"tui smoke ok: drew {len(captured)} bytes and quit")
        return 0
    note(captured)
    print(
        f"tui smoke failed: exit {code}, drew {len(captured)} bytes, quit_sent {sent_q}, frame {drew}",
        file=sys.stderr,
    )
    return 1


def note(captured: bytearray) -> None:
    if len(captured) > 1500:
        return
    sys.stderr.buffer.write(captured)
    if captured and not captured.endswith(b"\n"):
        sys.stderr.buffer.write(b"\n")


if __name__ == "__main__":
    sys.exit(main())
