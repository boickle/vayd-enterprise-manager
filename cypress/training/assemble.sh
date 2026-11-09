#!/bin/bash
# Make the narrated video for one scene: crop the Cypress recording to the app, start it where the black
# frame ends, and lay each voice clip at the moment its line started.
# The finished video plays at TRAINING_SPEED (default 1.25x; the owner found normal speed slow). The voice keeps
# its pitch. TRAINING_SPEED=1 makes a normal-speed video.
# Usage: assemble.sh <out folder from the recording> <final .mp4>
set -euo pipefail
OUT="$1"; FINAL="$2"
VIDEO=$(ls "$OUT"/videos/*.mp4 | head -1)
python3 -I - "$OUT" "$VIDEO" "$FINAL" <<'PY'
import json, os, re, subprocess, sys
out, video, final = sys.argv[1:4]
speed = float(os.environ.get("TRAINING_SPEED") or "1.25")
marks = json.load(open(f"{out}/marks.json"))
lines = json.load(open(f"{out}/narration.json"))
frame = marks.pop("__frame")
clicks = marks.pop("__clicks", [])
cuts = [c for c in marks.pop("__cuts", []) if c[1] - c[0] > 200]
# Cut stretches marked offCamera() and move everything after each cut earlier by its length.
def shift(t):
    return t - sum(min(max(t - a, 0), b - a) for a, b in cuts)
marks = {k: round(shift(v)) for k, v in marks.items()}
clicks = [round(shift(t)) for t in clicks]
# A soft, short click for every click and drop, so viewers hear what they see.
click_wav = f"{out}/click.wav"
subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                "anoisesrc=d=0.035:c=pink:a=0.6,highpass=f=1500,afade=t=out:st=0.005:d=0.03",
                "-ar", "24000", "-ac", "1", click_wav], check=True)

probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "json", video], capture_output=True, text=True, check=True)
vw, vh = (lambda s: (s["width"], s["height"]))(json.loads(probe.stdout)["streams"][0])
sx, sy = vw / frame["topW"], vh / frame["topH"]
x, y = round(frame["x"] * sx), round(frame["y"] * sy)
w, h = round(frame["w"] * sx) // 2 * 2, round(frame["h"] * sy) // 2 * 2
crop = f"crop={w}:{h}:{x}:{y}"

# Time zero = where the black frame ends inside the cropped app.
bd = subprocess.run(["ffmpeg", "-hide_banner", "-i", video, "-vf", f"{crop},blackdetect=d=0.5:pix_th=0.05",
                     "-an", "-f", "null", "-"], capture_output=True, text=True).stderr
ends = [float(m) for m in re.findall(r"black_end:([0-9.]+)", bd)]
if not ends:
    sys.exit("No black start frame found in the recording")
zero = ends[0]

last = max(marks[l["id"]] + l["ms"] for l in lines) / 1000 + 2.0
cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{zero:.3f}", "-i", video]
filters, labels = [], []
for i, l in enumerate(lines, start=1):
    cmd += ["-i", f"{out}/voice/{l['id']}.aiff"]
    delay = marks[l["id"]]
    filters.append(f"[{i}:a]adelay={delay}|{delay},aformat=channel_layouts=stereo[a{i}]")
    labels.append(f"[a{i}]")
for j, t in enumerate(clicks):
    k = len(lines) + 1 + j
    cmd += ["-i", click_wav]
    filters.append(f"[{k}:a]adelay={t}|{t},aformat=channel_layouts=stereo,volume=0.5[c{j}]")
    labels.append(f"[c{j}]")
filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,atempo={speed}[voice]")
keep = "+".join(f"between(t,{a/1000:.3f},{b/1000:.3f})" for a, b in cuts)
cut = f",select='not({keep})',setpts=N/30/TB" if cuts else ""
filters.append(f"[0:v]{crop},fps=30{cut},scale=1920:-2:flags=lanczos,setpts=PTS/{speed},fps=30[v]")
cmd += ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[voice]", "-t", f"{last / speed:.2f}",
        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", final]
subprocess.run(cmd, check=True)
print(f"{final}: {last / speed:.1f} s at {speed}x, cropped {w}x{h} at {x},{y}, video zero at {zero:.2f} s")
PY
