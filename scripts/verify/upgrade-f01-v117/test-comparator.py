#!/usr/bin/env python3
"""Local executable check of the actual comparator, without Docker or product tests."""

import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path

comparator = Path(__file__).resolve().with_name("compare-preservation.py")
before = {
    "organizations": [["org-a", "fixture-a", "Fixture A", "Fixture", "active", "UTC", {"brand": "original"}]],
    "contacts": [["contact-a", "org-a", "Original name"]],
}


def run_case(directory, after, expected_success, name):
    (directory / "before-data.json").write_text(json.dumps(before))
    (directory / "upgraded-data.json").write_text(json.dumps(after))
    result = subprocess.run([sys.executable, str(comparator), str(directory)], capture_output=True, text=True)
    if (result.returncode == 0) != expected_success:
        raise SystemExit(f"COMPARATOR_CHECK=FAIL case={name} exit={result.returncode}\n{result.stdout}{result.stderr}")


with tempfile.TemporaryDirectory(prefix="crm-os-upgrade-comparator-") as temporary:
    directory = Path(temporary)
    run_case(directory, copy.deepcopy(before), True, "unchanged")
    allowed = copy.deepcopy(before)
    allowed["organizations"][0][6]["canonical_conversation_tags"] = [
        "dúvida", "reclamação", "troca", "devolução", "elogio", "orçamento", "pós-venda", "urgente",
    ]
    run_case(directory, allowed, True, "documented_missing_default")
    changed = copy.deepcopy(before)
    changed["contacts"][0][2] = "Altered existing name"
    run_case(directory, changed, False, "previous_value_changed")
    extra = copy.deepcopy(before)
    extra["organizations"][0][6]["undeclared_setting"] = True
    run_case(directory, extra, False, "unapproved_setting_added")

print("COMPARATOR_CHECK identity=1/1 accepted_default=1/1 negative=2/2")
