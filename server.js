const express = require("express");
const cors = require("cors");
const TinyTTS = require("tiny-tts");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
app.use(cors());
app.use(express.json());

let tts = null;

async function initTTS() {
  tts = new TinyTTS();
  console.log("[TinyTTS] Model loaded and ready");
}

app.post("/speak", async (req, res) => {
  const { text, speed = 1.0 } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  if (!tts) {
    return res.status(503).json({ error: "TTS not ready yet" });
  }

  try {
    const tmpFile = path.join(os.tmpdir(), `tts-${Date.now()}.wav`);
    await tts.speak(text, tmpFile, { speed });

    res.setHeader("Content-Type", "audio/wav");
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("end", () => {
      fs.unlink(tmpFile, () => {});
    });
  } catch (err) {
    console.error("[TinyTTS] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: tts ? "ready" : "loading" });
});

const PORT = 8787;
app.listen(PORT, async () => {
  console.log(`[TinyTTS] Server starting on http://localhost:${PORT}`);
  await initTTS();
  console.log(`[TinyTTS] Ready! Extension can now play audio.`);
});
