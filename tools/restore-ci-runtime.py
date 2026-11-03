"""Restore the pinned, profile-free Windows runtime used by release CI."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'ci-runtime.json').read_text())
archive = ROOT / 'artifacts/ci-runtime.zip'
archive.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['gh', 'release', 'download', 'build-runtime-v1', '--repo', 'cheudara-hub/amara-downloader',
                '--pattern', 'amara-runtime-win-x64.zip', '--output', str(archive), '--clobber'], check=True)
if hashlib.sha256(archive.read_bytes()).hexdigest() != config['sha256']:
    raise ValueError('Runtime checksum mismatch')
destination = ROOT / 'Hongguo English'
with zipfile.ZipFile(archive) as package:
    for entry in package.infolist():
        target = (destination / entry.filename).resolve()
        if not target.is_relative_to(destination.resolve()) or 'english-user-data' in target.parts or target.name == 'app.asar':
            raise ValueError('Runtime contains unexpected data')
    package.extractall(destination)
print('Pinned Windows runtime checksum verified and restored.')
