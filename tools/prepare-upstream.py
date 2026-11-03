"""Fetch upstream release source and a review diff without executing or applying it."""
from pathlib import Path, PurePosixPath
import argparse
import difflib
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'jackotom/hongguo-drama'


def download(url, destination, limit):
    # Fixed GitHub URLs only. Certificate verification remains enabled.
    subprocess.run(['curl.exe', '--fail', '--location', '--silent', '--show-error',
                    '--proto', '=https', '--proto-redir', '=https', '--max-time', '90',
                    '--max-filesize', str(limit), '--user-agent', 'AMARA-Upstream-Check',
                    '--output', str(destination), url], check=True)
    if destination.stat().st_size > limit:
        raise ValueError('Upstream response exceeds size limit')


def compare_archive(archive, source):
    changes, diffs = [], []
    with zipfile.ZipFile(archive) as package:
        if sum(entry.file_size for entry in package.infolist()) > 128 * 1024 * 1024:
            raise ValueError('Source archive exceeds expanded size limit')
        for entry in package.infolist():
            parts = PurePosixPath(entry.filename).parts
            if entry.is_dir() or len(parts) < 2:
                continue
            relative = PurePosixPath(*parts[1:])
            if '..' in relative.parts or relative.is_absolute() or '\\' in str(relative) or ':' in str(relative):
                raise ValueError('Unexpected archive path')
            name = str(relative)
            if not (name in ['main.js', 'preload.js', 'package.json'] or name.startswith('src/native/')):
                continue
            if not name.endswith(('.js', '.cjs', '.json')) or entry.file_size > 5 * 1024 * 1024:
                continue
            local = source.joinpath(*relative.parts)
            incoming = package.read(entry).decode('utf-8-sig')
            current = local.read_text(encoding='utf-8-sig') if local.is_file() else ''
            if current.replace('\r\n', '\n') == incoming.replace('\r\n', '\n'):
                continue
            changes.append(name)
            diffs.extend(difflib.unified_diff(current.splitlines(True), incoming.splitlines(True),
                                            fromfile='AMARA/' + name, tofile='upstream/' + name))
    return changes, ''.join(diffs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-checks', action='store_true', help='Only prepare the source/diff; do not validate the current local app')
    args = parser.parse_args()
    work = ROOT / 'artifacts/upstream-review'
    work.mkdir(parents=True, exist_ok=True)
    metadata = work / 'latest-release.json'
    download(f'https://api.github.com/repos/{REPO}/releases/latest', metadata, 1024 * 1024)
    release = json.loads(metadata.read_text(encoding='utf-8'))
    tag = release.get('tag_name', '')
    if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v?\d{1,6}\.\d{1,6}(?:\.\d{1,6})?', tag):
        raise ValueError('Expected a stable upstream version')
    folder = work / tag
    folder.mkdir(exist_ok=True)
    archive = folder / 'upstream-source.zip'
    download(f'https://codeload.github.com/{REPO}/zip/refs/tags/{tag}', archive, 64 * 1024 * 1024)
    changes, diff = compare_archive(archive, ROOT / 'source')
    (folder / 'compatibility-review.diff').write_text(diff, encoding='utf-8')
    report = {'repository': REPO, 'upstreamTag': tag,
              'integratedVersion': json.loads((ROOT / 'source/update-channel.json').read_text())['integratedUpstreamVersion'],
              'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
              'differentFiles': changes, 'sourceApplied': False,
              'localValidation': 'not run',
              'note': 'Diff compares current AMARA with upstream, including intentional AMARA customizations. Downloaded code is not executed. Local checks do not validate unintegrated upstream changes.'}
    report_file = folder / 'report.json'
    report_file.write_text(json.dumps(report, indent=2), encoding='utf-8')
    if not args.skip_checks:
        result = subprocess.run([sys.executable, str(ROOT / 'tools/check-windows.py')], cwd=ROOT)
        report['localValidation'] = 'passed' if result.returncode == 0 else 'failed'
        report_file.write_text(json.dumps(report, indent=2), encoding='utf-8')
        if result.returncode:
            raise RuntimeError('Local regression checks failed. No update was applied.')
    print(f'Upstream {tag}: source and compatibility diff saved to {folder}')
    print('Your app, settings, and downloads were kept. Source changes need compatibility review before integration.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
