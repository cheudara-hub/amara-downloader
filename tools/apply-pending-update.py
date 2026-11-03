"""Apply a staged package only when no AMARA processes are running."""
from pathlib import Path
import csv
import os
import shutil
import subprocess
import json
import re
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
pending = root / 'artifacts/pending-update.asar'
if not pending.exists():
    raise SystemExit(0)

processes = subprocess.run(
    ['tasklist.exe', '/FI', 'IMAGENAME eq AMARA Downloader.exe', '/FO', 'CSV', '/NH'],
    capture_output=True, text=True, check=True,
)
if any(row and row[0].lower() == 'amara downloader.exe' for row in csv.reader(processes.stdout.splitlines())):
    print('The update will be installed after AMARA is fully closed and launched again.')
    raise SystemExit(0)

target = root / 'Hongguo English/resources/app.asar'
version = json.loads((root / 'source/package.json').read_text(encoding='utf-8'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise ValueError('Invalid application version')
backup = root / 'backups/app.before-download-tracking.asar'
backup.parent.mkdir(parents=True, exist_ok=True)
if not backup.exists():
    shutil.copyfile(target, backup)
temporary = target.with_suffix('.asar.update')
# Source replacements are specific to the audited episode page, rather than a
# title or episode number that could accidentally match another show.
repair_file = root / 'artifacts/queue-repair.json'
queue_file = root / 'Hongguo English/resources/english-user-data/media-browser.json'
repaired = None
if repair_file.exists() and queue_file.exists():
    repair = json.loads(repair_file.read_text(encoding='utf-8'))
    repaired = json.loads(queue_file.read_text(encoding='utf-8'))
    replacements = {item['oldPageUrl']: item for item in repair['episodes']}
    for item in replacements.values():
        url = urlsplit(item['playerUrl'])
        if url.scheme != 'https' or url.hostname != 'ok.ru' or not url.path.startswith('/videoembed/') or url.username or url.password:
            raise ValueError('Invalid audited source replacement')
    for task in repaired.get('tasks', []):
        item = replacements.get(task.get('originalPageUrl') or task.get('pageUrl') or task.get('url'))
        if not item:
            continue
        output = Path(task['directory']) / task['filename']
        if task.get('status') == 'completed' and output.is_file() and output.stat().st_size > 0:
            continue
        task.update(originalPageUrl=item['oldPageUrl'], pageUrl=item['playerUrl'], url=item['playerUrl'],
                    referer=item['playerUrl'], direct=False, status='queued', error='', errorCode='',
                    bytes=0, speedBps=0, retryCount=0)
        task.pop('totalBytes', None)
        task.pop('time', None)
    queue_backup = root / 'backups/media-browser.before-source-repair.json'
    if not queue_backup.exists():
        shutil.copyfile(queue_file, queue_backup)

shutil.copyfile(pending, temporary)
os.replace(temporary, target)
# Keep the built portable application current too, preserving its own profile.
portable = root / f'release/AMARA-Downloader-v{version}-Windows-Portable/resources/app.asar'
if portable.is_file():
    if not portable.resolve().is_relative_to((root / 'release').resolve()):
        raise ValueError('Portable package is outside the release directory')
    portable_backup = root / f'backups/portable-{version}.before-thumbnail-fix.asar'
    if not portable_backup.exists():
        shutil.copyfile(portable, portable_backup)
    portable_temporary = portable.with_suffix('.asar.update')
    shutil.copyfile(pending, portable_temporary)
    os.replace(portable_temporary, portable)
if repaired is not None:
    queue_temporary = queue_file.with_suffix('.json.tmp')
    queue_temporary.write_text(json.dumps(repaired, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(queue_temporary, queue_file)
    shutil.copyfile(repair_file, root / 'backups/queue-repair.applied.json')
    repair_file.unlink()
pending.unlink()
print('AMARA download update installed.')
