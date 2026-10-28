"""Print the accuracy of the NLP pipeline, per intent and overall.

    python scripts/evaluate.py               # every case, store results included
    python scripts/evaluate.py --target 0.95 # a different accuracy gate
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.evaluation import CASES, check_case  # noqa: E402
from app.pipeline import NlpPipeline  # noqa: E402

TARGET = 0.90


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=float, default=TARGET, help="overall accuracy gate")
    args = parser.parse_args()

    pipeline = NlpPipeline()
    pipeline.ensure_ready()

    outcomes = [check_case(pipeline, case) for case in CASES]
    per_intent: dict[str, list[int]] = {}
    for outcome in outcomes:
        entry = per_intent.setdefault(outcome.case.intent, [0, 0])
        entry[1] += 1
        entry[0] += 1 if outcome.ok else 0

    print(f"{'intent':32} {'ok':>4} {'total':>6} {'accuracy':>9}")
    for name in sorted(per_intent):
        correct, total = per_intent[name]
        print(f"{name:32} {correct:>4} {total:>6} {correct / total:>8.0%}")

    correct = sum(1 for outcome in outcomes if outcome.ok)
    total = len(outcomes)
    accuracy = correct / total if total else 0.0
    covered = {case.intent for case in CASES}
    print(f"\n{total} cases, {len(covered)} intents covered, accuracy {accuracy:.1%}")

    failures = [outcome for outcome in outcomes if not outcome.ok]
    if failures:
        print("\nfailures:")
        for outcome in failures:
            print(f"  - {outcome.case.question!r}: {'; '.join(outcome.problems)}")

    if accuracy < args.target:
        print(f"\nBELOW TARGET {args.target:.0%}")
        return 1
    print(f"\nTARGET {args.target:.0%} MET")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
