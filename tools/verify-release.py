"""Verify a successful CI build's release artifacts before publication."""
from pathlib import Path
import hashlib
import json
import re
import sys

folder, validation = map(Path, sys.argv[1:3])
manifest = json.loads((folder / 'amara-update.json').read_text(encoding='utf-8'))
version = manifest.get('version', '')
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise ValueError('Invalid AMARA version')
expected = f'AMARA-Downloader-Setup-{version}.exe'
if manifest.get('product') != 'AMARA Downloader' or manifest.get('platform') != 'win32-x64' or manifest.get('filename') != expected:
    raise ValueError('Unexpected release identity')
rows = json.loads(validation.read_text(encoding='utf-8'))
checked = [row for row in rows if 'passed' in row]
if not checked or not all(row['passed'] is True for row in checked):
    raise ValueError('CI validation did not pass')
if manifest.get('validation') != {'passed': True, 'testFiles': len(checked)}:
    raise ValueError('Validation metadata does not match CI report')
setup = folder / expected
digest = hashlib.sha256(setup.read_bytes()).hexdigest()
if digest != manifest.get('sha256') or digest != setup.with_suffix('.exe.sha256').read_text().split()[0]:
    raise ValueError('Installer checksum mismatch')
with setup.open('rb') as stream:
    if stream.read(2) != b'MZ':
        raise ValueError('Expected a Windows EXE')
print(f'Verified AMARA {version}: installer checksum and {len(checked)} passing test files.')
