"""Exercise the real desktop UI using mocked providers and an isolated profile."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    from PIL import Image
    work = ROOT / 'artifacts/windows-build'
    work.mkdir(parents=True, exist_ok=True)
    review = Path(tempfile.mkdtemp(prefix='desktop-review-', dir=work))
    runtime = review / 'runtime'
    shutil.copytree(ROOT / 'Hongguo English', runtime,
                    ignore=shutil.ignore_patterns('english-user-data', 'app.asar', '*.log'))
    subprocess.run([sys.executable, str(ROOT / 'tools/build-amara.py'), '--output', str(runtime / 'resources/app.asar')], check=True)
    Image.open(ROOT / 'source/pro/assets/placeholder_drama.png').convert('RGB').save(review / 'cover.jpg')
    subprocess.run([str(runtime / 'resources/bin/ffmpeg.exe'), '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'color=c=blue:s=160x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    str(review / 'episode-1-sample.mp4')], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    print(f'Desktop verification artifacts: {review}', flush=True)
    with (review / 'desktop.log').open('w', encoding='utf-8') as log:
        result = subprocess.run([str(runtime / 'AMARA Downloader.exe'), '--pro-smoke-test',
                                 f'--user-data-dir={review / "data"}'], cwd=runtime, env=env,
                                stdout=log, stderr=subprocess.STDOUT, timeout=90,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    report = review / 'checks.json'
    if result.returncode or not report.exists() or not json.loads(report.read_text(encoding='utf-8')).get('success'):
        print((review / 'desktop.log').read_text(encoding='utf-8', errors='replace')[-6000:])
        raise RuntimeError(f'Desktop verification failed. See {review}')
    print(f'PASS: desktop UI, native downloads, and saved episode marks. Report: {report}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
