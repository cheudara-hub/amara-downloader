"""Run local regression checks before packaging; never uses personal app data."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-upstream', action='store_true', help='Also diagnose inherited integration tests for features absent from this edition')
    args = parser.parse_args()
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is required for validation. Install Node.js LTS, then run the build again.')
    tests = sorted((ROOT / 'tests').glob('test-*.js')) + sorted((ROOT / 'source/src/native').glob('*.test.cjs'))
    failures, results = [], []
    inherited = {
        'app-announcements.test.cjs': 'Remote announcement UI and service are not enabled in AMARA.',
        'text-export-integration.test.cjs': 'Text export integration is not enabled in AMARA; module tests still run.',
        'preview-startup.test.cjs': 'Tests the separate upstream experience-preview edition.',
    }
    for test in tests:
        name = test.relative_to(ROOT).as_posix()
        if test.name in inherited and not args.include_upstream:
            results.append({'test': name, 'skipped': inherited[test.name]})
            print(f'SKIP {name}: {inherited[test.name]}', flush=True)
            continue
        try:
            result = subprocess.run([node, str(test)], cwd=ROOT, capture_output=True, text=True,
                                    encoding='utf-8', errors='replace', timeout=60)
            passed, output = result.returncode == 0, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            passed, output = False, 'Test exceeded 60 seconds.'
        results.append({'test': name, 'passed': passed, 'output': output})
        print(f'{"PASS" if passed else "FAIL"} {name}', flush=True)
        if not passed:
            failures.append(name)
            print(output[-3000:], flush=True)
    result = subprocess.run([sys.executable, str(ROOT / 'tests/test-windows-build.py')], cwd=ROOT,
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
    results.append({'test': 'tests/test-windows-build.py', 'passed': result.returncode == 0, 'output': result.stdout + result.stderr})
    print(f'{"PASS" if result.returncode == 0 else "FAIL"} tests/test-windows-build.py', flush=True)
    if result.returncode:
        failures.append('tests/test-windows-build.py')
        print(result.stdout + result.stderr)
    report = ROOT / 'artifacts/windows-build/validation.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    ran = sum('passed' in result for result in results)
    skipped = sum('skipped' in result for result in results)
    print(f'{ran - len(failures)}/{ran} active test files passed; {skipped} inherited suites skipped. Report: {report}', flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
