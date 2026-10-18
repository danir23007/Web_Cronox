#!/usr/bin/python3 -I
"""Prevent automatic writer resurrection during an interrupted release/maintenance."""
import json
from pathlib import Path
import sys

permit = Path('/run/cronox-release-bootstrap-permit')
if permit.exists():
    st = permit.lstat()
    if not permit.is_symlink() and st.st_uid == 0 and not st.st_mode & 0o077:
        permit.unlink()  # single-use initial installer handoff; absent after reboot
        sys.exit(0)
if Path('/var/lib/cronox/maintenance.flag').exists():
    sys.exit(1)
for file in Path('/var/lib/cronox-release').glob('*/status.json'):
    if json.loads(file.read_text())['status'] not in ('success', 'recovered', 'failed_before_maintenance'):
        sys.exit(1)
