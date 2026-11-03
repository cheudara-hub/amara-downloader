"""Package the local AMARA sources without re-running localization."""
from pathlib import Path
import hashlib
import json
import struct
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, help="Write a review or pending-update package without replacing the running app")
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
files = []
tree = {'files': {}}
offset = 0
for file in sorted((root / 'source').rglob('*')):
    if not file.is_file():
        continue
    parts = file.relative_to(root / 'source').parts
    node = tree
    for part in parts[:-1]:
        node = node['files'].setdefault(part, {'files': {}})
    data = file.read_bytes()
    node['files'][parts[-1]] = {'size': len(data), 'offset': str(offset), 'integrity': {
        'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': 4194304,
        'blocks': [hashlib.sha256(data[i:i+4194304]).hexdigest() for i in range(0, len(data), 4194304)]}}
    files.append(data)
    offset += len(data)
raw = json.dumps(tree, separators=(',', ':')).encode()
payload = struct.pack('<I', len(raw)) + raw
payload += b'\0' * (-len(payload) % 4)
header = struct.pack('<I', len(payload)) + payload
target = args.output.resolve() if args.output else root / 'Hongguo English/resources/app.asar'
target.parent.mkdir(parents=True, exist_ok=True)
backup = root / 'backups/app.before-amara.asar'
backup.parent.mkdir(parents=True, exist_ok=True)
if not args.output and not backup.exists():
    backup.write_bytes(target.read_bytes())
target.write_bytes(struct.pack('<II', 4, len(header)) + header + b''.join(files))
print('Built AMARA:', target)
