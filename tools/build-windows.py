"""Build the current source into Windows setup and portable testing applications."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import importlib.util

ROOT = Path(__file__).resolve().parents[1]


def write_update_manifest(setup, version, validation, output):
    results = json.loads(validation.read_text(encoding='utf-8'))
    checked = [item for item in results if 'passed' in item]
    if not checked or any(item['passed'] is not True for item in checked):
        raise ValueError('AMARA update metadata requires passing regression checks')
    if setup.name != f'AMARA-Downloader-Setup-{version}.exe':
        raise ValueError('Unexpected update installer name')
    output.write_text(json.dumps({
        'product': 'AMARA Downloader', 'version': version, 'platform': 'win32-x64',
        'filename': setup.name, 'sha256': hashlib.sha256(setup.read_bytes()).hexdigest(),
        'validation': {'passed': True, 'testFiles': len(checked)},
    }, indent=2) + '\n', encoding='utf-8')


def write_uninstall_manifest(runtime, output):
    if (runtime / 'resources/english-user-data').exists():
        raise ValueError('Runtime staging contains personal data; refusing to package it')
    def quoted(relative):
        return str(relative).replace('$', '$$').replace('"', '$\\"')
    files = sorted(p for p in runtime.rglob('*') if p.is_file())
    lines = [f'  Delete "$INSTDIR\\{quoted(p.relative_to(runtime))}"' for p in files]
    directories = sorted((p for p in runtime.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True)
    lines += [f'  RMDir "$INSTDIR\\{quoted(p.relative_to(runtime))}"' for p in directories]
    output.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check build requirements without building')
    parser.add_argument('--no-pause', action='store_true', help='Do not pause after build')
    args = parser.parse_args()
    if not shutil.which('node'):
        raise FileNotFoundError('Node.js LTS is required for pre-build regression checks.')
    for module in ('PIL', 'numpy'):
        if importlib.util.find_spec(module) is None:
            raise RuntimeError('Icon build dependencies missing. Run: python -m pip install Pillow numpy')
    version = json.loads((ROOT / 'source/package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('source/package.json must contain a version such as 2.8.1')
    candidates = [ROOT / 'artifacts/build-tools/nsis-3.11/makensis.exe']
    for variable in ('ProgramFiles(x86)', 'ProgramFiles'):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / 'NSIS/makensis.exe')
    if shutil.which('makensis'):
        candidates.append(Path(shutil.which('makensis')))
    compiler = next((item for item in candidates if item.is_file()), None)
    if compiler is None:
        raise FileNotFoundError('NSIS compiler not found. Install NSIS or restore artifacts/build-tools/nsis-3.11.')
    for name in ('Hongguo English/AMARA Downloader.exe', 'Hongguo English/amara.ico',
                 'source/main.js', 'source/node_modules/axios/package.json', 'tools/installer.nsi',
                 'Hongguo English/resources/bin/ffmpeg.exe', 'Hongguo English/resources/bin/ffprobe.exe',
                 'assets/AMARA LOGO DL.png', 'tools/check-windows.py'):
        if not (ROOT / name).is_file():
            raise FileNotFoundError(f'Required build file missing: {name}')
    output = ROOT / f'release/AMARA-Downloader-Setup-{version}.exe'
    portable = ROOT / f'release/AMARA-Downloader-v{version}-Windows-Portable'
    print(f'AMARA Windows setup {version}', flush=True)
    print(f'Compiler: {compiler}', flush=True)
    print(f'Output: {output}', flush=True)
    print(f'Testing app: {portable / "AMARA Downloader.exe"}', flush=True)
    if args.check:
        print('Build requirements OK. No files changed.')
        return
    if (portable / 'resources/english-user-data').exists():
        raise ValueError('Existing portable folder contains user data. Move it aside before rebuilding; it was kept.')
    print('\n[1/4] Running local regression checks...', flush=True)
    subprocess.run([sys.executable, '-u', str(ROOT / 'tools/check-windows.py')], cwd=ROOT, check=True)
    work = ROOT / 'artifacts/windows-build'
    work.mkdir(parents=True, exist_ok=True)
    package = work / 'app.asar'
    staged = work / f'AMARA-Downloader-Setup-{version}.exe'
    log = work / 'installer-build.log'
    runtime = work / 'runtime'
    # A clean copy prevents an open development app or old portable profile from
    # interfering with the build. Never edit the currently running executable.
    if runtime.exists():
        if runtime.is_symlink() or not runtime.resolve().is_relative_to(ROOT.resolve()) or runtime.resolve().parent != work.resolve():
            raise ValueError('Unexpected runtime staging path')
        shutil.rmtree(runtime)
    shutil.copytree(ROOT / 'Hongguo English', runtime,
                    ignore=shutil.ignore_patterns('english-user-data', 'app.asar', '*.log'))
    print('\n[2/4] Updating the staged application icon...', flush=True)
    subprocess.run([sys.executable, str(ROOT / 'tools/set-amara-icon.py'), '--runtime', str(runtime)],
                   cwd=ROOT, check=True)
    print('\n[3/4] Packaging the latest source...', flush=True)
    subprocess.run([sys.executable, str(ROOT / 'tools/build-amara.py'), '--output', str(package)],
                   cwd=ROOT, check=True)
    shutil.copyfile(package, runtime / 'resources/app.asar')
    manifest = work / 'uninstall-files.nsh'
    write_uninstall_manifest(runtime, manifest)
    print('\n[4/4] Building setup EXE. Compression can take several minutes.', flush=True)
    print(f'Compiler log: {log}', flush=True)
    try:
        subprocess.run([str(compiler), '/V3', f'/O{log}', f'/DAMARA_VERSION={version}',
                        f'/DOUTPUT_FILE={staged}', f'/DAPP_PACKAGE={package}',
                        f'/DRUNTIME_DIR={runtime}', f'/DUNINSTALL_FILES={manifest}',
                        str(ROOT / 'tools/installer.nsi')], cwd=ROOT, check=True)
    except subprocess.CalledProcessError:
        if log.exists():
            print(log.read_text(encoding='utf-8', errors='replace')[-6000:])
        raise
    with staged.open('rb') as stream:
        if stream.read(2) != b'MZ':
            raise ValueError('Compiler output is not a Windows EXE')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.exe.tmp')
    shutil.copyfile(staged, temporary)
    os.replace(temporary, output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.exe.sha256').write_text(f'{digest}  {output.name}\n', encoding='ascii')
    write_update_manifest(output, version, work / 'validation.json', output.parent / 'amara-update.json')
    # Keep the runnable EXE beside its required Electron files, with no personal data.
    if (portable / 'resources/english-user-data').exists():
        raise ValueError('Existing portable folder contains user data. Move it aside before rebuilding; it was kept.')
    shutil.copytree(runtime, portable, dirs_exist_ok=True)
    (portable / 'START HERE.txt').write_text(
        f'AMARA Downloader {version}\n\nDouble-click AMARA Downloader.exe to test without installing.\n'
        'Keep this whole folder together; the EXE needs its DLLs and resources.\n', encoding='utf-8')
    if (portable / 'resources/english-user-data').exists():
        raise ValueError('Portable build must not contain personal application data')
    print(f'\nReady: {output}\nSize: {output.stat().st_size / 1048576:.1f} MB', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'\nERROR: {error}', file=sys.stderr)
        sys.exit(1)
