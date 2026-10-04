"""Word error rate of the running sidecar on a folder of recordings.

Each recording sits next to a .txt file holding what was actually said,
written out by a person who listened to it:

    recordings/ravi.webm
    recordings/ravi.txt

    python services/ml/eval/wer.py recordings/ --url http://localhost:8001

Only use recordings from people who agreed to them being used this way.
Standard library only, so it runs on the host without installing anything.
"""

import argparse
import json
import unicodedata
import urllib.request
from pathlib import Path

AUDIO = {".webm", ".m4a", ".mp4", ".ogg", ".wav", ".aiff", ".mp3"}


def words(text: str) -> list[str]:
    # Punctuation and case aren't what an employer misreads, so they don't
    # count as errors. Only punctuation and symbols go: \W would also strip
    # combining marks, which in Devanagari are the vowels.
    text = unicodedata.normalize("NFC", text).lower()
    return "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in text).split()


def edit_distance(ref: list[str], hyp: list[str]) -> int:
    row = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(hyp, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (r != h))
    return row[-1]


def transcribe(url: str, audio: bytes) -> dict:
    request = urllib.request.Request(
        f"{url}/transcribe", data=audio, headers={"Content-Type": "application/octet-stream"}
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--url", default="http://localhost:8001")
    args = parser.parse_args()

    errors = total = 0
    for audio in sorted(p for p in args.folder.iterdir() if p.suffix.lower() in AUDIO):
        reference = audio.with_suffix(".txt")
        if not reference.exists():
            print(f"{audio.name}: no {reference.name}, skipped")
            continue
        ref = words(reference.read_text(encoding="utf-8"))
        result = transcribe(args.url, audio.read_bytes())
        hyp = words(result["text"])
        wrong = edit_distance(ref, hyp)
        errors += wrong
        total += len(ref)
        print(
            f"{audio.name}: WER {wrong / max(len(ref), 1):.0%} "
            f"({result['language']} {result['languageProbability']:.0%}, {result['durationSeconds']:.1f}s)"
        )
        print(f"  said:  {' '.join(ref)}")
        print(f"  heard: {' '.join(hyp)}")

    if total:
        print(f"\nOverall WER {errors / total:.1%} over {total} words")


if __name__ == "__main__":
    main()
