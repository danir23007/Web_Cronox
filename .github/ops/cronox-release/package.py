"""Build a reviewable bootstrap archive; no secrets and no server changes."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

HERE = Path(__file__).resolve().parent
FILES = ('install.py', 'controller.py', 'backup.py', 'boot_guard.py', 'selftest.py', 'mailbox_storage.py',
         'build.sh', 'preflight.cjs', 'cronox-release', 'cronox-release@.service',
         'pm2-deploy.service', 'sudoers')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python package.py OUTPUT.tar.gz')
    output = Path(sys.argv[1])
    if output.exists():
        sys.exit('OUTPUT_EXISTS: choose a new artifact path')
    output.parent.mkdir(parents=True, exist_ok=True)
    contents = {name: (HERE / name).read_bytes().replace(b'\r\n', b'\n') for name in FILES}
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
    contents['manifest.json'] = json.dumps(manifest, indent=2, sort_keys=True).encode()
    with tarfile.open(output, 'w:gz') as tar:
        for name, data in contents.items():
            entry = tarfile.TarInfo('cronox-release-bootstrap/' + name)
            entry.size, entry.mode, entry.uid, entry.gid, entry.mtime = len(data), 0o600, 0, 0, 0
            tar.addfile(entry, io.BytesIO(data))
    print(json.dumps({'artifact': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                      'files': len(contents), 'containsCredentials': False}))
