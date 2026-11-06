#!/bin/bash
# Turn a scene's narration into voice clips, and write <out>/narration.json with each line's length.
#
#   make-voice.sh <scene narration .json> <voice> <out folder>
#
# <voice> = "openai:nova" (OpenAI text-to-speech; key read from the macOS Keychain item "openai-tts")
#           or a macOS voice name such as "Zoe (Premium)" (made on this Mac with `say`).
# Only the narration text is sent to OpenAI. It must never contain real client data.
set -euo pipefail
SRC="$1"; VOICE="$2"; OUT="$3"
mkdir -p "$OUT/voice"
if [[ "$VOICE" == openai:* ]]; then
  OPENAI_API_KEY=$(security find-generic-password -a "$USER" -s openai-tts -w)
  export OPENAI_API_KEY
fi
python3 -I - "$SRC" "$VOICE" "$OUT" <<'PY'
import hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request
src, voice, out = sys.argv[1:4]
lines = json.load(open(src))
STYLE = ("Warm, calm and friendly, like an experienced veterinary technician teaching a new teammate. "
         "Natural pace, light smile in the voice, clear pauses between sentences. Not salesy.")

def openai_clip(text, name, wav):
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=json.dumps({"model": "gpt-4o-mini-tts", "voice": name, "input": text,
                         "instructions": STYLE, "response_format": "wav"}).encode(),
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}", "Content-Type": "application/json"})
    for attempt in range(3):  # the connection sometimes drops; try again before giving up
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            break
        except OSError:
            if attempt == 2:
                raise
            time.sleep(5)
    with open(wav, "wb") as f:
        f.write(data)

# Clips are cached by voice + style + text, so a re-take only makes the lines that changed.
cache = os.path.join(os.environ.get("TRAINING_WORK", os.path.expanduser("~/.vayd-training")), "voice-cache")
os.makedirs(cache, exist_ok=True)
made = 0
for l in lines:
    clip = f"{out}/voice/{l['id']}.aiff"
    key = hashlib.sha256(json.dumps([voice, STYLE, l["text"]]).encode()).hexdigest()[:20]
    cached = f"{cache}/{key}.aiff"
    if not os.path.exists(cached):
        made += 1
        if voice.startswith("openai:"):
            wav = f"{cache}/{key}.wav"
            openai_clip(l["text"], voice.split(":", 1)[1], wav)
            subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav, cached], check=True)
            os.remove(wav)
        else:
            subprocess.run(["say", "-v", voice, "-r", "175", "-o", cached, l["text"]], check=True)
    shutil.copyfile(cached, clip)
    info = subprocess.run(["afinfo", clip], capture_output=True, text=True, check=True).stdout
    l["ms"] = round(float(re.search(r"estimated duration: ([0-9.]+)", info).group(1)) * 1000)
json.dump(lines, open(f"{out}/narration.json", "w"), indent=2)
print(f"{len(lines)} lines ({made} new), {sum(l['ms'] for l in lines)/1000:.1f} s of voice ({voice})")
PY
