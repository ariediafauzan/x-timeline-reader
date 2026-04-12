import asyncio
import io
import os
import json
import time
import threading
import requests as http_requests
import psutil
import edge_tts
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Engine registry ──────────────────────────────────────────────────
ENGINES = {
    "edge-tts": {
        "name": "Edge TTS (Cloud)",
        "ram": 0,
        "quality": "great",
        "speed": "fast",
        "note": "Free, needs internet. Best default.",
        "type": "cloud",
        "voices": {
            "Andrew": "en-US-AndrewMultilingualNeural",
            "Ava": "en-US-AvaMultilingualNeural",
            "Brian": "en-US-BrianMultilingualNeural",
            "Emma": "en-US-EmmaMultilingualNeural",
            "Steffan": "en-US-SteffanNeural",
            "Jenny": "en-US-JennyNeural",
            "Guy": "en-US-GuyNeural",
            "Aria": "en-US-AriaNeural",
            "Davis": "en-US-DavisNeural",
            "Ryan_UK": "en-GB-RyanNeural",
            "Sonia": "en-GB-SoniaNeural",
        },
    },
    # kokoro removed: requires Python <3.13, venv is 3.14
    "qwen3-0.6b": {
        "name": "Qwen3 TTS 0.6B",
        "ram": 2.5,
        "quality": "good",
        "speed": "medium",
        "note": "Alibaba open-source. Good balance.",
        "type": "local",
        "pip": "qwen-tts",
        "hf_model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "voices": {
            "Aiden": "Aiden", "Ryan": "Ryan", "Vivian": "Vivian",
            "Serena": "Serena", "Dylan": "Dylan", "Eric": "Eric",
        },
    },
    "qwen3-1.7b": {
        "name": "Qwen3 TTS 1.7B",
        "ram": 7,
        "quality": "great",
        "speed": "slow",
        "note": "Best open-source quality. Needs 16GB+ RAM.",
        "type": "local",
        "pip": "qwen-tts",
        "hf_model": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "voices": {
            "Aiden": "Aiden", "Ryan": "Ryan", "Vivian": "Vivian",
            "Serena": "Serena", "Dylan": "Dylan", "Eric": "Eric",
        },
    },
    # parler-mini removed: tokenizers fails to build on Python 3.14
    "voxcpm2": {
        "name": "VoxCPM2 0.5B",
        "ram": 2,
        "quality": "great",
        "speed": "slow",
        "note": "OpenBMB. Very realistic voice. Pre-buffers next tweets.",
        "type": "local",
        "pip": "voxcpm",
        "hf_model": "openbmb/VoxCPM2",
        "voices": {
            "Default": "default",
        },
    },
    "pocket-tts": {
        "name": "Pocket TTS 100M",
        "ram": 0.5,
        "quality": "good",
        "speed": "fast",
        "note": "Kyutai Labs. CPU-only, ~6x realtime. Lightweight & fast.",
        "type": "local",
        "pip": "pocket-tts",
        "hf_model": "kyutai/pocket-tts",
        "voices": {
            "Alba": "alba", "Marius": "marius", "Javert": "javert",
            "Jean": "jean", "Fantine": "fantine", "Cosette": "cosette",
            "Eponine": "eponine", "Azelma": "azelma",
        },
    },
}

# ── State ────────────────────────────────────────────────────────────
current_engine_id = "edge-tts"
local_model = None
local_engine_id = None
hf_pipeline = None
hf_model_id = None
last_request_time = time.time()
last_speak_time = time.time()
MODEL_IDLE_TIMEOUT = 300   # 5 min — unload local models
SERVER_IDLE_TIMEOUT = 600  # 10 min no requests at all — shut down server


def _idle_watcher():
    """Background thread: unload models after 5 min, shutdown server after 10 min."""
    global local_model, local_engine_id, hf_pipeline, hf_model_id, current_engine_id
    while True:
        time.sleep(60)
        now = time.time()

        # Unload models after 5 min of no /speak calls
        if local_model is not None or hf_pipeline is not None:
            speak_idle = now - last_speak_time
            if speak_idle > MODEL_IDLE_TIMEOUT:
                freed = []
                if local_model is not None:
                    freed.append(local_engine_id or "local")
                    local_model = None
                    local_engine_id = None
                if hf_pipeline is not None:
                    freed.append(hf_model_id or "hf")
                    hf_pipeline = None
                    hf_model_id = None
                if freed:
                    current_engine_id = "edge-tts"
                    with _cache_lock:
                        _audio_cache.clear()
                        _prebuffer_queue.clear()
                    try:
                        import gc
                        import torch
                        gc.collect()
                        if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                            torch.mps.empty_cache()
                    except Exception:
                        pass
                    print(f"[TTS] Idle {int(speak_idle)}s — unloaded {', '.join(freed)}, switched to Edge TTS")

        # Shut down server after 10 min of zero requests
        server_idle = now - last_request_time
        if server_idle > SERVER_IDLE_TIMEOUT:
            print(f"[TTS] No requests for {int(server_idle)}s — shutting down to save resources.")
            os._exit(0)


_idle_thread = threading.Thread(target=_idle_watcher, daemon=True)
_idle_thread.start()

# ── Pre-buffer cache for slow engines ───────────────────────────────
import hashlib
from collections import OrderedDict

_audio_cache = OrderedDict()       # hash -> (buf_bytes, mime)
_cache_lock = threading.Lock()
_prebuffer_queue = []               # list of (text, speaker, rate) to generate
_prebuffer_thread = None
MAX_CACHE = 20                      # keep last 20 generated audios


def _cache_key(text, speaker, rate):
    return hashlib.md5(f"{text}|{speaker}|{rate}".encode()).hexdigest()


def _cache_get(key):
    with _cache_lock:
        if key in _audio_cache:
            _audio_cache.move_to_end(key)
            return _audio_cache[key]
    return None


def _cache_put(key, buf_bytes, mime):
    with _cache_lock:
        _audio_cache[key] = (buf_bytes, mime)
        while len(_audio_cache) > MAX_CACHE:
            _audio_cache.popitem(last=False)


def _prebuffer_worker():
    """Background thread that pre-generates audio for queued texts."""
    global _prebuffer_thread
    while True:
        with _cache_lock:
            if not _prebuffer_queue:
                _prebuffer_thread = None
                return
            text, speaker, rate = _prebuffer_queue.pop(0)

        key = _cache_key(text, speaker, rate)
        if _cache_get(key):
            continue  # already cached

        synth = SYNTH_MAP.get(current_engine_id)
        if not synth:
            continue

        try:
            print(f"[TTS] Pre-buffering: {text[:50]}...")
            buf, mime = synth(text, speaker, rate)
            _cache_put(key, buf.read(), mime)
            print(f"[TTS] Pre-buffered OK: {text[:50]}...")
        except Exception as e:
            print(f"[TTS] Pre-buffer error: {e}")


def _start_prebuffer():
    global _prebuffer_thread
    if _prebuffer_thread is None or not _prebuffer_thread.is_alive():
        _prebuffer_thread = threading.Thread(target=_prebuffer_worker, daemon=True)
        _prebuffer_thread.start()

# ── Download progress tracking ──────────────────────────────────────
dl_state = {
    "active": False,
    "progress": 0,
    "total_bytes": 0,
    "model_id": None,
    "status": "idle",   # idle, downloading, loading, ready, error
    "error": None,
}


def _get_model_size_bytes(model_id):
    """Get total model file size from HuggingFace API."""
    try:
        from huggingface_hub import HfApi
        info = HfApi().model_info(model_id, files_metadata=True)
        return sum(s.size or 0 for s in info.siblings)
    except Exception as e:
        print(f"[TTS] Could not get model size for {model_id}: {e}")
        return 0


def _get_cache_bytes(model_id):
    """Get bytes currently in HF cache for this model."""
    from huggingface_hub.constants import HF_HUB_CACHE
    cache_dir = os.path.join(HF_HUB_CACHE, "models--" + model_id.replace("/", "--"))
    if not os.path.exists(cache_dir):
        return 0
    total = 0
    for root, _, files in os.walk(cache_dir):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def _download_and_load_hf(model_id):
    """Background thread: download model, then load into pipeline."""
    global hf_pipeline, hf_model_id, current_engine_id, local_model, local_engine_id
    try:
        dl_state["status"] = "downloading"

        # Get total size for progress calculation
        total = _get_model_size_bytes(model_id)
        dl_state["total_bytes"] = total

        # Download model files to cache
        from huggingface_hub import snapshot_download
        snapshot_download(model_id)

        # Now load into memory
        dl_state["status"] = "loading"
        dl_state["progress"] = 100

        import torch
        from transformers import pipeline as hf_pipe

        local_model = None
        local_engine_id = None
        hf_pipeline = None
        hf_model_id = None

        hf_pipeline = hf_pipe(
            "text-to-speech", model=model_id,
            device="mps", torch_dtype=torch.float32,
            trust_remote_code=True,
        )
        hf_model_id = model_id
        current_engine_id = "_hf_pipeline"

        dl_state["status"] = "ready"
        dl_state["progress"] = 100
        print(f"[TTS] HF model ready: {model_id}")

    except Exception as e:
        err = str(e)
        # Give user-friendly error messages
        if "Unrecognized model" in err or "model_type" in err:
            friendly = f"This model uses a custom architecture not supported by auto-loading. Check its HuggingFace page for install instructions."
        elif "trust_remote_code" in err:
            friendly = f"This model requires custom code that couldn't be loaded."
        elif "not a valid model" in err.lower() or "404" in err:
            friendly = f"Model not found. Check the model ID is correct."
        elif "out of memory" in err.lower() or "mps" in err.lower():
            friendly = f"Not enough memory to load this model. Try a smaller one."
        else:
            friendly = err[:200]
        dl_state["status"] = "error"
        dl_state["error"] = friendly
        print(f"[TTS] Download/load failed for {model_id}: {e}")
    finally:
        dl_state["active"] = False


def get_system_ram_gb():
    return round(psutil.virtual_memory().total / (1024 ** 3), 1)


def rate_to_str(rate):
    pct = int((rate - 1.0) * 100)
    return f"+{pct}%" if pct >= 0 else f"{pct}%"


def get_recommendations():
    ram = get_system_ram_gb()
    recs = []
    for eid, eng in ENGINES.items():
        fits = eng["ram"] < ram * 0.5  # use less than half of total RAM
        recs.append({
            "id": eid,
            "name": eng["name"],
            "ram_gb": eng["ram"],
            "quality": eng["quality"],
            "speed": eng["speed"],
            "note": eng["note"],
            "type": eng["type"],
            "recommended": fits,
            "voices": list(eng["voices"].keys()),
        })
    return recs, ram


# ── Engine loaders ───────────────────────────────────────────────────
def load_local_model(engine_id):
    global local_model, local_engine_id

    if local_engine_id == engine_id and local_model is not None:
        return True

    eng = ENGINES.get(engine_id)
    if not eng or eng["type"] == "cloud":
        return True

    # Unload previous
    local_model = None
    local_engine_id = None

    if engine_id.startswith("qwen3"):
        import torch
        from qwen_tts import Qwen3TTSModel
        print(f"[TTS] Loading {eng['hf_model']} on MPS...")
        local_model = Qwen3TTSModel.from_pretrained(
            eng["hf_model"], device_map="mps", dtype=torch.float32,
        )
        local_engine_id = engine_id
        print(f"[TTS] {eng['name']} loaded!")
        return True

    if engine_id == "voxcpm2":
        from voxcpm import VoxCPM
        print("[TTS] Loading VoxCPM2 on MPS...")
        local_model = VoxCPM.from_pretrained(
            eng["hf_model"], load_denoiser=False, optimize=False,
        )
        local_engine_id = engine_id
        print("[TTS] VoxCPM2 loaded!")
        return True

    if engine_id == "pocket-tts":
        from pocket_tts import TTSModel
        print("[TTS] Loading Pocket TTS (CPU)...")
        local_model = TTSModel.load_model()
        local_engine_id = engine_id
        print("[TTS] Pocket TTS loaded!")
        return True

    return False


def load_hf_pipeline(model_id):
    """Load any HuggingFace TTS model via transformers pipeline."""
    global hf_pipeline, hf_model_id, local_model, local_engine_id
    import torch
    from transformers import pipeline as hf_pipe

    if hf_model_id == model_id and hf_pipeline is not None:
        return True

    # Unload previous
    local_model = None
    local_engine_id = None
    hf_pipeline = None
    hf_model_id = None

    print(f"[TTS] Downloading & loading HF model: {model_id} ...")
    hf_pipeline = hf_pipe(
        "text-to-speech",
        model=model_id,
        device="mps",
        torch_dtype=torch.float32,
        trust_remote_code=True,
    )
    hf_model_id = model_id
    print(f"[TTS] HF model loaded: {model_id}")
    return True


# ── Synthesis ────────────────────────────────────────────────────────
def synthesize_edge(text, speaker, rate):
    eng = ENGINES["edge-tts"]
    voice_id = eng["voices"].get(speaker, "en-US-AndrewMultilingualNeural")
    buf = io.BytesIO()

    async def gen():
        comm = edge_tts.Communicate(text, voice_id, rate=rate_to_str(rate))
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])

    asyncio.run(gen())
    buf.seek(0)
    return buf, "audio/mpeg"


def synthesize_qwen(text, speaker, rate):
    import soundfile as sf
    wavs, sr = local_model.generate_custom_voice(
        text=text, language="English", speaker=speaker,
    )
    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format="WAV")
    buf.seek(0)
    return buf, "audio/wav"


def synthesize_hf_pipeline(text, speaker, rate):
    import soundfile as sf
    import numpy as np
    result = hf_pipeline(text)
    # Handle different output formats from various models
    if isinstance(result, dict):
        audio = np.array(result.get("audio", result.get("waveform", []))).squeeze()
        sr = result.get("sampling_rate", result.get("sample_rate", 22050))
    elif isinstance(result, (list, tuple)):
        audio = np.array(result[0]).squeeze()
        sr = result[1] if len(result) > 1 else 22050
    else:
        audio = np.array(result).squeeze()
        sr = 22050
    if audio.ndim == 0 or audio.size == 0:
        raise ValueError("Model returned empty audio")
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    buf.seek(0)
    return buf, "audio/wav"


def synthesize_voxcpm(text, speaker, rate):
    import soundfile as sf
    wav = local_model.generate(text=text, cfg_value=2.0, inference_timesteps=10)
    sr = local_model.tts_model.sample_rate
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV")
    buf.seek(0)
    return buf, "audio/wav"


def synthesize_pocket(text, speaker, rate):
    import scipy.io.wavfile
    voice_name = ENGINES["pocket-tts"]["voices"].get(speaker, "alba")
    voice_state = local_model.get_state_for_audio_prompt(voice_name)
    audio = local_model.generate_audio(voice_state, text)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, local_model.sample_rate, audio.numpy())
    buf.seek(0)
    return buf, "audio/wav"


SYNTH_MAP = {
    "edge-tts": synthesize_edge,
    "qwen3-0.6b": synthesize_qwen,
    "qwen3-1.7b": synthesize_qwen,
    "voxcpm2": synthesize_voxcpm,
    "pocket-tts": synthesize_pocket,
    "_hf_pipeline": synthesize_hf_pipeline,
}


# ── Middleware: track last request time ──────────────────────────────
@app.before_request
def _track_activity():
    global last_request_time
    last_request_time = time.time()


# ── Routes ───────────────────────────────────────────────────────────
@app.route("/speak", methods=["POST"])
def speak():
    global last_speak_time
    last_speak_time = time.time()

    data = request.get_json()
    text = data.get("text", "")
    speaker = data.get("speaker", "Andrew")
    rate = data.get("rate", 1.0)

    if not text:
        return jsonify({"error": "No text provided"}), 400

    # Check pre-buffer cache first
    key = _cache_key(text, speaker, rate)
    cached = _cache_get(key)
    if cached:
        print(f"[TTS] Cache hit: {text[:50]}...")
        buf_bytes, mime = cached
        return send_file(io.BytesIO(buf_bytes), mimetype=mime)

    synth = SYNTH_MAP.get(current_engine_id)
    if not synth:
        return jsonify({"error": f"Unknown engine: {current_engine_id}"}), 400

    try:
        buf, mime = synth(text, speaker, rate)
        # Cache the result
        buf_bytes = buf.read()
        _cache_put(key, buf_bytes, mime)
        return send_file(io.BytesIO(buf_bytes), mimetype=mime)
    except Exception as e:
        print(f"[TTS] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/prebuffer", methods=["POST"])
def prebuffer():
    """Queue upcoming texts for background generation."""
    data = request.get_json()
    texts = data.get("texts", [])
    speaker = data.get("speaker", "Andrew")
    rate = data.get("rate", 1.0)

    queued = 0
    for text in texts[:5]:  # max 5 at a time
        if not text:
            continue
        key = _cache_key(text, speaker, rate)
        if _cache_get(key):
            continue  # already cached
        with _cache_lock:
            _prebuffer_queue.append((text, speaker, rate))
        queued += 1

    if queued > 0:
        _start_prebuffer()

    return jsonify({"status": "ok", "queued": queued})


@app.route("/health", methods=["GET"])
def health():
    idle_secs = int(time.time() - last_speak_time)
    server_idle = int(time.time() - last_request_time)
    model_loaded = local_model is not None or hf_pipeline is not None
    ram_used = psutil.Process().memory_info().rss / (1024 ** 3)

    base = {
        "status": "ready",
        "idle_seconds": idle_secs,
        "model_loaded": model_loaded,
        "server_ram_gb": round(ram_used, 2),
        "auto_unload_in": max(0, MODEL_IDLE_TIMEOUT - idle_secs) if model_loaded else None,
        "auto_shutdown_in": max(0, SERVER_IDLE_TIMEOUT - server_idle),
    }

    if current_engine_id == "_hf_pipeline" and hf_model_id:
        return jsonify({**base,
            "engine": "_hf_pipeline",
            "engine_name": hf_model_id.split("/")[-1],
            "model_id": hf_model_id,
            "speakers": [],
        })
    eng = ENGINES.get(current_engine_id, ENGINES["edge-tts"])
    return jsonify({**base,
        "engine": current_engine_id,
        "engine_name": eng["name"],
        "speakers": list(eng["voices"].keys()),
    })


@app.route("/engines", methods=["GET"])
def list_engines():
    recs, ram = get_recommendations()
    return jsonify({"system_ram_gb": ram, "engines": recs})


@app.route("/engine", methods=["POST"])
def switch_engine():
    global current_engine_id
    data = request.get_json()
    engine_id = data.get("engine")

    if engine_id not in ENGINES:
        return jsonify({"error": f"Unknown engine: {engine_id}"}), 400

    eng = ENGINES[engine_id]

    # Check RAM
    ram = get_system_ram_gb()
    if eng["ram"] > ram * 0.7:
        return jsonify({
            "error": f"{eng['name']} needs ~{eng['ram']}GB RAM but you only have {ram}GB total. This might freeze your system.",
            "warning": True,
        }), 400

    if eng["type"] == "local":
        try:
            print(f"[TTS] Switching to {eng['name']}...")
            load_local_model(engine_id)
        except ImportError as e:
            return jsonify({
                "error": f"Missing dependency. Run: pip install {eng.get('pip', '')}",
                "install_cmd": f"pip install {eng.get('pip', '')}",
            }), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    current_engine_id = engine_id
    print(f"[TTS] Now using: {eng['name']}")
    return jsonify({
        "status": "ok",
        "engine": engine_id,
        "engine_name": eng["name"],
        "speakers": list(eng["voices"].keys()),
    })


@app.route("/load-hf", methods=["POST"])
def load_hf_model():
    """Start downloading and loading any HF model in the background."""
    data = request.get_json()
    model_id = data.get("model_id", "").strip()

    if not model_id:
        return jsonify({"error": "No model_id provided"}), 400

    # Check if it maps to a built-in engine (synchronous)
    for prefix, engine_id in SUPPORTED_PREFIXES.items():
        if model_id.startswith(prefix):
            return switch_engine_internal(engine_id)

    # Already downloading?
    if dl_state["active"]:
        return jsonify({"error": "Another model is downloading. Please wait."}), 409

    ram = get_system_ram_gb()
    ram_est = estimate_ram(model_id)
    if ram_est > ram * 0.7:
        return jsonify({
            "error": f"This model needs ~{ram_est}GB but you have {ram}GB. Might freeze your system.",
            "warning": True,
        }), 400

    # Start background download
    dl_state.update(
        active=True, model_id=model_id, status="downloading",
        progress=0, total_bytes=0, error=None,
    )
    thread = threading.Thread(target=_download_and_load_hf, args=(model_id,), daemon=True)
    thread.start()

    return jsonify({"status": "downloading", "model_id": model_id})


@app.route("/download-progress", methods=["GET"])
def download_progress():
    """Poll this to get current download/load progress."""
    progress = dl_state["progress"]

    # While downloading, estimate progress from cache size vs total
    if dl_state["active"] and dl_state["status"] == "downloading":
        total = dl_state.get("total_bytes", 0)
        if total > 0:
            cached = _get_cache_bytes(dl_state["model_id"])
            progress = min(99, int(cached / total * 100))

    return jsonify({
        "active": dl_state["active"],
        "status": dl_state["status"],
        "progress": progress,
        "model_id": dl_state["model_id"],
        "error": dl_state["error"],
    })


def switch_engine_internal(engine_id):
    """Helper to switch to a built-in engine from load-hf route."""
    global current_engine_id
    eng = ENGINES.get(engine_id)
    if not eng:
        return jsonify({"error": "Unknown engine"}), 400
    if eng["type"] == "local":
        try:
            load_local_model(engine_id)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    current_engine_id = engine_id
    return jsonify({
        "status": "ok",
        "engine": engine_id,
        "engine_name": eng["name"],
        "speakers": list(eng["voices"].keys()),
    })


# ── Trending HuggingFace models ──────────────────────────────────────
_trending_cache = {"data": None, "ts": 0}
CACHE_TTL = 3600  # 1 hour

# Models we have built-in support for
SUPPORTED_PREFIXES = {
    "Qwen/Qwen3-TTS-12Hz-0.6B": "qwen3-0.6b",
    "Qwen/Qwen3-TTS-12Hz-1.7B": "qwen3-1.7b",
    "openbmb/VoxCPM": "voxcpm2",
    "kyutai/pocket-tts": "pocket-tts",
}

# Models known to NOT work with transformers pipeline auto-loading
INCOMPATIBLE_MODELS = {
    "myshell-ai/MeloTTS",   # needs melotts package
    "RVC-Project",          # needs rvc package
    "suno/bark",            # needs specific bark package
}

def is_likely_compatible(model_id, tags):
    """Check if a model is likely to work with transformers pipeline."""
    for prefix in INCOMPATIBLE_MODELS:
        if model_id.startswith(prefix):
            return False
    if "transformers" in tags:
        return True
    return True  # optimistic default


def estimate_ram(model_id, safetensors_size=None):
    """Rough RAM estimate from model name or known sizes."""
    lower = model_id.lower()
    if safetensors_size:
        return round(safetensors_size / (1024 ** 3) * 1.2, 1)  # +20% overhead
    if "pocket-tts" in lower or "100m" in lower:
        return 0.5
    if "0.5b" in lower or "82m" in lower:
        return 0.5
    if "0.6b" in lower:
        return 2.5
    if "1b" in lower or "1.0b" in lower:
        return 4
    if "1.5b" in lower or "1.6b" in lower or "1.7b" in lower:
        return 7
    if "4b" in lower:
        return 16
    return 3  # default guess


@app.route("/trending", methods=["GET"])
def trending():
    now = time.time()
    if _trending_cache["data"] and (now - _trending_cache["ts"]) < CACHE_TTL:
        return jsonify(_trending_cache["data"])

    ram = get_system_ram_gb()
    results = []

    try:
        resp = http_requests.get(
            "https://huggingface.co/api/models",
            params={
                "pipeline_tag": "text-to-speech",
                "sort": "likes",
                "direction": "-1",
                "limit": 20,
            },
            timeout=10,
        )
        models = resp.json()

        for m in models:
            model_id = m.get("id", "")
            likes = m.get("likes", 0)
            downloads = m.get("downloads", 0)
            tags = m.get("tags", [])

            # Check if we support this model natively
            supported_engine = None
            for prefix, engine_id in SUPPORTED_PREFIXES.items():
                if model_id.startswith(prefix):
                    supported_engine = engine_id
                    break

            ram_est = estimate_ram(model_id)
            fits = ram_est < ram * 0.5
            compatible = is_likely_compatible(model_id, tags)

            results.append({
                "model_id": model_id,
                "likes": likes,
                "downloads": downloads,
                "ram_estimate_gb": ram_est,
                "fits_ram": fits,
                "supported": supported_engine is not None,
                "engine_id": supported_engine,
                "compatible": compatible,
                "tags": [t for t in tags if t in ("pytorch", "onnx", "safetensors", "transformers")],
            })

        data = {"system_ram_gb": ram, "models": results, "fetched_at": int(now)}
        _trending_cache["data"] = data
        _trending_cache["ts"] = now
        return jsonify(data)

    except Exception as e:
        print(f"[TTS] Failed to fetch trending: {e}")
        return jsonify({"error": "Could not fetch trending models", "models": []}), 502


# ── Cache management ────────────────────────────────────────────────
def _get_hf_cache_dir():
    from huggingface_hub.constants import HF_HUB_CACHE
    return HF_HUB_CACHE


def _dir_size_bytes(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


@app.route("/cached-models", methods=["GET"])
def list_cached_models():
    """List all HF models in the local cache with their sizes."""
    cache_dir = _get_hf_cache_dir()
    models = []
    total_bytes = 0

    if not os.path.exists(cache_dir):
        return jsonify({"models": [], "total_size_gb": 0})

    for entry in os.listdir(cache_dir):
        if not entry.startswith("models--"):
            continue
        model_id = entry.replace("models--", "").replace("--", "/", 1)
        model_path = os.path.join(cache_dir, entry)
        size = _dir_size_bytes(model_path)
        total_bytes += size
        models.append({
            "model_id": model_id,
            "size_bytes": size,
            "size_gb": round(size / (1024 ** 3), 2),
            "size_display": _format_size(size),
            "is_active": (model_id == hf_model_id) or
                (current_engine_id in ENGINES and
                 ENGINES[current_engine_id].get("hf_model", "").startswith(model_id)),
        })

    models.sort(key=lambda m: m["size_bytes"], reverse=True)
    return jsonify({
        "models": models,
        "total_size_gb": round(total_bytes / (1024 ** 3), 2),
        "total_size_display": _format_size(total_bytes),
    })


@app.route("/cached-models/<path:model_id>", methods=["DELETE"])
def delete_cached_model(model_id):
    """Delete a specific model from the HF cache."""
    import shutil
    cache_dir = _get_hf_cache_dir()
    dir_name = "models--" + model_id.replace("/", "--")
    model_path = os.path.join(cache_dir, dir_name)

    if not os.path.exists(model_path):
        return jsonify({"error": "Model not found in cache"}), 404

    # Don't delete the currently active model
    if model_id == hf_model_id:
        return jsonify({"error": "Cannot delete the currently active model. Switch to another model first."}), 400

    size = _dir_size_bytes(model_path)
    shutil.rmtree(model_path)
    print(f"[TTS] Deleted cached model: {model_id} ({_format_size(size)})")
    return jsonify({"status": "ok", "freed_bytes": size, "freed_display": _format_size(size)})


def _format_size(bytes_val):
    if bytes_val >= 1024 ** 3:
        return f"{bytes_val / (1024 ** 3):.1f} GB"
    if bytes_val >= 1024 ** 2:
        return f"{bytes_val / (1024 ** 2):.0f} MB"
    return f"{bytes_val / 1024:.0f} KB"


if __name__ == "__main__":
    ram = get_system_ram_gb()
    print(f"[TTS] System RAM: {ram} GB")
    print(f"[TTS] Default engine: Edge TTS (cloud)")
    print(f"[TTS] Auto-shutdown after {SERVER_IDLE_TIMEOUT}s idle")
    print(f"[TTS] Server running on http://localhost:8787")
    app.run(host="127.0.0.1", port=8787)
