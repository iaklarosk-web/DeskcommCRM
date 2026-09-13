#!/usr/bin/env python3
"""Compare business projections; allow only the named missing-default backfill."""

import json
import sys
from pathlib import Path

EXPECTED_TAGS = [
    "dúvida", "reclamação", "troca", "devolução", "elogio",
    "orçamento", "pós-venda", "urgente",
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compare(directory):
    before = json.loads((directory / "before-data.json").read_text())
    after = json.loads((directory / "upgraded-data.json").read_text())
    require(isinstance(before, dict) and isinstance(after, dict), "invalid snapshot")
    require(before and all(isinstance(v, list) and v for v in before.values()), "empty fixture group")
    require(set(before) == set(after), "snapshot groups changed")
    old_orgs, new_orgs = before["organizations"], after["organizations"]
    require(len(old_orgs) == len(new_orgs), "organization count changed")
    added = 0
    for old, new in zip(old_orgs, new_orgs):
        require(len(old) == len(new) == 7, "organization projection changed")
        require(old[:6] == new[:6], "organization identity/config changed")
        old_settings, new_settings = old[6], new[6]
        require(isinstance(old_settings, dict) and isinstance(new_settings, dict), "invalid settings")
        extras = set(new_settings) - set(old_settings)
        require(extras <= {"canonical_conversation_tags"}, "unexpected setting added")
        require(
            all(k in new_settings and new_settings[k] == v for k, v in old_settings.items()),
            "existing settings overwritten",
        )
        if extras:
            require(new_settings["canonical_conversation_tags"] == EXPECTED_TAGS, "unexpected defaults")
            new[6] = {k: v for k, v in new_settings.items() if k not in extras}
            added += 1
    require(before == after, "unexpected domain change; inspect preservation.diff")
    return len(before), added


if __name__ == "__main__":
    try:
        groups, added_keys = compare(Path(sys.argv[1]))
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"PRESERVATION=FAIL reason={error}", file=sys.stderr)
        sys.exit(1)
    print(f"preserved_groups={groups}/{groups} expected_added_default_keys={added_keys} prior_values_changed=0")
