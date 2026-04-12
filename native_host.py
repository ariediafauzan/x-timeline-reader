#!/usr/bin/env python3
"""Native Messaging host for X Reader TTS.
Chrome calls this to start the TTS server on demand."""
import json
import struct
import subprocess
import socket
import sys
import os
import time


def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        return None
    length = struct.unpack("<I", raw)[0]
    msg = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(msg)


def send_message(msg):
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def is_server_running():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(("127.0.0.1", 8787))
        s.close()
        return True
    except Exception:
        return False


def start_server():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    venv_python = os.path.join(script_dir, "venv", "bin", "python")
    server_script = os.path.join(script_dir, "tts_server.py")
    log = open("/tmp/xreader-tts.log", "a")
    subprocess.Popen(
        [venv_python, server_script],
        cwd=script_dir,
        stdout=log,
        stderr=log,
        start_new_session=True,
    )


msg = read_message()
if msg:
    if not is_server_running():
        start_server()
        # Wait for server to be ready
        for _ in range(10):
            time.sleep(0.5)
            if is_server_running():
                break
    send_message({"status": "ok", "running": is_server_running()})
