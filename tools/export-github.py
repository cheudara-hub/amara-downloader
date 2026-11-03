"""Prepare an allowlisted public source tree and a separate private build payload."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / 'artifacts/github-public'
destination.mkdir(parents=True, exist_ok=True)
provider = json.loads((ROOT / 'source/src/pro-config.json').read_text(encoding='utf-8'))
license_source = (ROOT / 'source/src/native/license-validator.js').read_text(encoding='utf-8')
match = re.search(r"const LICENSE_SECRET = (['\"])(.*?)\1;", license_source)
if not match:
    raise ValueError('Cannot identify private license configuration')
license_secret = match[2]
secrets = [license_secret] + [str(provider[key]) for key in ['secret', 'deviceId'] if len(str(provider.get(key, ''))) >= 8]

allowed_roots = ['source', 'tests', 'assets']
allowed_tools = ['build-amara.py', 'build-windows.py', 'set-amara-icon.py', 'check-windows.py',
                 'check-desktop.py', 'apply-pending-update.py', 'installer.nsi', 'prepare-upstream.py',
                 'configure-private-build.py', 'restore-ci-runtime.py', 'export-github.py']
files = []
for name in allowed_roots:
    files += [p for p in (ROOT / name).rglob('*') if p.is_file() and not any(
        part in ['node_modules', '__pycache__', '.git'] or part.startswith('.') for part in p.relative_to(ROOT / name).parts)]
files += [ROOT / 'tools' / name for name in allowed_tools]
files += [ROOT / 'Launch AMARA.cmd', ROOT / 'Build Windows EXE.bat', ROOT / 'Check Hongguo Updates.cmd']
files += list((ROOT / '.github/workflows').glob('*.yml'))
files += [ROOT / 'docs' / name for name in ['RELEASE-2.8.10.md', 'RELEASE-CURRENT.md', 'UPDATES.md', 'MODIFICATIONS.txt']]
for file in files:
    if not file.exists():
        raise ValueError('Missing export file: ' + str(file.relative_to(ROOT)))
    target = destination / file.relative_to(ROOT)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = file.read_bytes()
    if file.suffix in ['.js', '.cjs', '.json', '.html', '.py', '.md', '.txt', '.yml', '.cmd', '.bat']:
        try:
            text = data.decode('utf-8-sig')
            for secret in secrets:
                text = text.replace(secret, 'CONFIGURE_PRIVATE_LICENSE_SECRET' if secret == license_secret else 'CONFIGURE_PRIVATE_PROVIDER_VALUE')
            data = text.encode('utf-8')
        except UnicodeDecodeError:
            pass
    target.write_bytes(data)
public_provider = {**provider, 'deviceId': 'CONFIGURE_PROVIDER_DEVICE_ID', 'secret': 'CONFIGURE_PROVIDER_SECRET'}
(destination / 'source/src/pro-config.json').write_text(json.dumps(public_provider, indent=2) + '\n', encoding='utf-8')
(destination / '.gitignore').write_text('''node_modules/
artifacts/
backups/
release/
english-user-data/
Hongguo English/
__pycache__/
*.log
.env*
source/src/pro-config.private.json
''', encoding='utf-8')
upstream = ROOT / 'artifacts/upstream-v5.4/source/hongguo-drama-5.4'
for name in ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']:
    shutil.copy2(upstream / name, destination / name)
(destination / 'README.md').write_text('''# AMARA Downloader

Customized Hongguo desktop downloader with upstream release monitoring, batch recovery, and tested Windows releases.

- [Download tested AMARA releases](https://github.com/cheudara-hub/amara-downloader/releases/latest)
- [How updates work](docs/UPDATES.md)
- [Hongguo upstream](https://github.com/jackotom/hongguo-drama)

Upstream checks run every six hours. New source is downloaded as a review artifact; it is not automatically executed or merged. Reviewed AMARA changes are validated by regression tests before tagged Windows releases are published. Passing tests cannot guarantee live provider availability.

Public source excludes provider credentials, license signing material, user profiles, queues, and media. Build settings are injected from encrypted GitHub Actions secrets. Contributors can run offline regression tests with synthetic configuration; production builds require the repository owner's private configuration. Licensed platform access is still required where applicable.

See LICENSE, NOTICE, THIRD-PARTY-NOTICES.md and docs/MODIFICATIONS.txt for upstream attribution. This modified edition is distributed under GPL-3.0.
''', encoding='utf-8')

# Separate bootstrap runtime contains binaries/notices only, never an app package or profile.
runtime = ROOT / 'Hongguo English'
archive = ROOT / 'artifacts/amara-runtime-win-x64.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as package:
    for file in runtime.rglob('*'):
        if not file.is_file():
            continue
        relative = file.relative_to(runtime)
        if 'english-user-data' in relative.parts or file.name == 'app.asar' or file.suffix == '.log':
            continue
        package.write(file, str(relative))
(destination / 'ci-runtime.json').write_text(json.dumps({
    'asset': 'amara-runtime-win-x64.zip', 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'electronVersion': '44.9.1', 'source': 'Existing AMARA runtime; original licenses/notices retained. No app package or profile.'
}, indent=2) + '\n', encoding='utf-8')

for file in destination.rglob('*'):
    if file.is_file() and '.git' not in file.relative_to(destination).parts:
        data = file.read_bytes()
        if any(secret.encode() in data for secret in secrets):
            raise ValueError('Private configuration found in public export: ' + str(file.relative_to(destination)))
private = ROOT / 'artifacts/github-private-build.json'
private.write_text(json.dumps({'providerConfiguration': provider, 'licenseSecret': license_secret}), encoding='utf-8')
print(f'Public export prepared and private-value scan passed: {destination}')
print('Private build payload saved separately; never commit or upload it as a release asset.')
