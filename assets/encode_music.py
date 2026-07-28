#!/usr/bin/env python3
"""Re-encode the soundtrack master down to something a phone can afford.

The master out of Final Cut is 265 kbps, which is 3.0 MB for 96 seconds — four
times the size of the entire rest of the site, for birdsong played at a third
volume under a game. 128 kbps CBR is 1.47 MB and nothing is audibly lost.

The important part is not the bitrate, it's the padding. An mp3 decodes to more
frames than it holds music: the encoder brackets the audio with its own delay and
padding, and Web Audio hands all of that back. Re-encoding naively bakes the
master's padding into the new file as real silence, permanently, which is exactly
the tick this whole thing exists to avoid. ffmpeg does not apply the master's
gapless trim on decode — verified, it returns all 4233600 frames — so the trim is
done explicitly here, from the master's own iTunSMPB figures, before a single
sample reaches the encoder.

Then the encoder records its own delay and padding, and game.js skips those. Note
this must be the lame CLI and not ffmpeg's libmp3lame: ffmpeg writes an Info
header but no LAME extension, so the gapless figures come out missing, and
`-map_metadata` cheerfully copies the master's iTunSMPB, whose numbers no longer
describe the file they're attached to.

    python3 assets/encode_music.py        # needs ffmpeg and lame

Run inside the devbox sandbox — `devbox-audio` is devbox plus those two packages.
"""

import os
import re
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, "kookaburralonger.mp3")
OUT = os.path.join(HERE, "kookaburralonger.128.mp3")
BITRATE = 128

TITLE = "song for game"
ARTIST = "Tom Bennetts"
ALBUM = "RidingWithTom's Simmo Run"


def id3v2_size(data):
    """Bytes to skip to clear an ID3v2 tag, 0 if there isn't one."""
    if data[:3] != b"ID3":
        return 0
    n = 0
    for b in data[6:10]:
        n = (n << 7) | (b & 0x7F)
    return 10 + n


def first_frame(data, start):
    """Offset of the first MPEG audio frame at or after start."""
    i = start
    while i < len(data) - 4:
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            return i
        i += 1
    sys.exit("no MPEG frame found")


def frame_rate(data, at):
    """Sample rate declared by the frame header."""
    ver = (data[at + 1] >> 3) & 3
    idx = (data[at + 2] >> 2) & 3
    table = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}
    if ver not in table or idx == 3:
        sys.exit("unsupported MPEG frame header")
    return table[ver][idx]


def itunsmpb(data):
    """(delay, padding, music) from the Apple gapless comment."""
    tag = data[: id3v2_size(data)]
    at = tag.find(b"iTunSMPB")
    if at < 0:
        sys.exit(f"{MASTER} has no iTunSMPB tag — no exact figures to trim by, refusing "
                 "to guess. Re-export it from a tool that writes gapless information.")
    text = tag[at:at + 220].decode("latin1", "replace")
    fields = re.findall(r"[0-9A-Fa-f]{8,16}", text)
    if len(fields) < 4:
        sys.exit("iTunSMPB tag did not parse")
    return int(fields[1], 16), int(fields[2], 16), int(fields[3], 16)


def lame_gapless(path):
    """(delay, padding, raw_frames) the encoder recorded in its own tag."""
    data = open(path, "rb").read()
    at = first_frame(data, id3v2_size(data))
    window = data[at:at + 500]
    xing = window.find(b"Xing")
    if xing < 0:
        xing = window.find(b"Info")
    if xing < 0:
        sys.exit("encoded file has no Xing/Info header")
    flags = struct.unpack(">I", window[xing + 4:xing + 8])[0]
    pos = xing + 8
    frames = None
    if flags & 1:
        frames = struct.unpack(">I", window[pos:pos + 4])[0]
        pos += 4
    lame = window.find(b"LAME", xing)
    if lame < 0:
        sys.exit("encoded file has no LAME extension — was it encoded with ffmpeg "
                 "instead of the lame CLI? ffmpeg omits the gapless figures.")
    b = window[lame + 21:lame + 24]
    delay = (b[0] << 4) | (b[1] >> 4)
    padding = ((b[1] & 0xF) << 8) | b[2]
    return delay, padding, (frames * 1152 if frames else None)


def run(*args):
    subprocess.run(args, check=True)


def main():
    for tool in ("ffmpeg", "lame"):
        if subprocess.run(["sh", "-c", f"command -v {tool}"],
                          capture_output=True).returncode:
            sys.exit(f"{tool} not found — run this in the devbox-audio image")

    data = open(MASTER, "rb").read()
    delay, padding, music = itunsmpb(data)
    rate = frame_rate(data, first_frame(data, id3v2_size(data)))
    print(f"master: {len(data) / 1048576:.2f} MB, {rate} Hz, "
          f"{music} frames of music = {music / rate:.4f} s "
          f"(dropping {delay} head, {padding} tail)")

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "music.wav")
        # sample-exact, so the encoder never sees the master's padding
        run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", MASTER,
            "-af", f"atrim=start_sample={delay}:end_sample={delay + music}",
            "-c:a", "pcm_s24le", "-ar", str(rate), "-ac", "2", wav)

        got = subprocess.run(
            ["ffprobe", "-hide_banner", "-loglevel", "error", "-show_entries",
             "stream=duration_ts", "-of", "csv=p=0", wav],
            capture_output=True, text=True, check=True).stdout.strip()
        if int(got) != music:
            sys.exit(f"trim produced {got} frames, expected {music}")

        run("lame", "--quiet", "-b", str(BITRATE), "--cbr", "-q", "2",
            "--tt", TITLE, "--ta", ARTIST, "--tl", ALBUM, wav, OUT)

    enc_delay, enc_pad, raw = lame_gapless(OUT)
    if raw is None:
        sys.exit("encoded file's Xing header has no frame count")
    round_trip = raw - enc_delay - enc_pad
    if round_trip != music:
        sys.exit(f"encoded file carries {round_trip} frames of music, expected {music} "
                 "— the gapless figures don't describe the audio")
    if b"iTunSMPB" in open(OUT, "rb").read()[: id3v2_size(open(OUT, "rb").read())]:
        sys.exit("encoded file inherited the master's iTunSMPB, whose figures are stale")

    size = os.path.getsize(OUT)
    print(f"wrote {os.path.relpath(OUT, os.path.dirname(HERE))}: "
          f"{size / 1048576:.2f} MB at {BITRATE} kbps CBR")
    print(f"  encoder delay {enc_delay}, padding {enc_pad}, "
          f"music {round_trip} frames = {round_trip / rate:.4f} s — matches the master")


if __name__ == "__main__":
    main()
