#!/usr/bin/env python3
"""Make a narrated video from clips of finished videos (no browser, no recording turn).

    python3 -I cypress/training/clip-video.py <narration .json> <voice> <marks folder> <videos folder> <final .mp4>

Each narration line names where its picture comes from: "from": "mem-02:m02-14" means the finished video whose
file name starts "MEM-02 " in <videos folder>, at the moment its line m02-14 starts. <marks folder> holds that
video's marks.json, saved as mem-02.marks.json (copy it from $TRAINING_WORK/<spec>/ right after the take, because the
next take of that spec overwrites it). Optional per line: "offset" (seconds, default 0.3) moves the clip start.

The new voice is made with make-voice.sh (same voice, style and cache as the recordings) and sped up like the
recordings (TRAINING_SPEED, default 1.25). Each clip lasts as long as its line, plus a short pause.
"""
import glob, json, os, subprocess, sys, tempfile

src, voice, marks_dir, videos_dir, final = sys.argv[1:6]
here = os.path.dirname(os.path.abspath(__file__))
speed = float(os.environ.get("TRAINING_SPEED") or "1.25")
PAUSE = 0.45  # seconds of picture after each line, at final speed
lines = json.load(open(src))
work = tempfile.mkdtemp(prefix="clip-video-")


def run(*cmd):
    subprocess.run(cmd, check=True)


def probe_len(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def video_time(marks, line_id):
    """Where a narration line starts in the finished (cut, sped-up) video, in seconds."""
    m = json.load(open(marks))
    cuts = [c for c in m.get("__cuts", []) if c[1] - c[0] > 200]
    t = m[line_id]
    t -= sum(min(b, t) - a for a, b in cuts if a < t)
    return t / 1000 / speed


run("bash", f"{here}/make-voice.sh", src, voice, work)
segs, auds = [], []
for i, l in enumerate(lines):
    vid, line_id = l["from"].split(":")
    found = glob.glob(os.path.join(videos_dir, f"{vid.upper()} *.mp4"))
    if len(found) != 1:
        sys.exit(f"{l['id']}: expected one finished video for {vid}, found {len(found)}")
    start = max(0.0, video_time(os.path.join(marks_dir, f"{vid}.marks.json"), line_id) + float(l.get("offset", 0.3)))
    clip = f"{work}/voice/{l['id']}.aiff"
    dur = probe_len(clip) / speed + PAUSE
    seg, aud = f"{work}/seg{i:02d}.mp4", f"{work}/aud{i:02d}.wav"
    # Picture only; hold the last frame if the source video ends first.
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", found[0], "-t", f"{dur:.3f}",
        "-an", "-vf", f"fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration={dur:.3f},trim=duration={dur:.3f}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "18", seg)
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", clip,
        "-af", f"aresample=24000,atempo={speed},apad=whole_dur={dur:.3f}", "-ac", "1", "-t", f"{dur:.3f}", aud)
    segs.append(seg); auds.append(aud)
    print(f"{l['id']}: {vid} {line_id} at {start:.1f} s, {dur:.1f} s")

with open(f"{work}/v.txt", "w") as f:
    f.writelines(f"file '{s}'\n" for s in segs)
with open(f"{work}/a.txt", "w") as f:
    f.writelines(f"file '{a}'\n" for a in auds)
run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{work}/v.txt",
    "-f", "concat", "-safe", "0", "-i", f"{work}/a.txt", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-shortest", final)
print(f"{final}: {probe_len(final):.1f} s from {len(lines)} clips")
