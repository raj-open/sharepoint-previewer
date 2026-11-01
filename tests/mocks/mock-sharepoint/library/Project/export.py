"""Exports the room list of the survey as CSV."""

import csv
import json


def export(survey: str, out: str) -> None:
    with open(survey, encoding="utf-8") as f:
        rooms = json.load(f)["rooms"]
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "area"])
        writer.writerows([r["name"], r["area"]] for r in rooms)
