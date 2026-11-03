"""Verify packaging safeguards without compiling or touching installed apps."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('windows_builder', ROOT / 'tools/build-windows.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackagingChecks(unittest.TestCase):
    def test_update_manifest_requires_passing_checks(self):
        import json
        import hashlib
        with tempfile.TemporaryDirectory(prefix='amara-manifest-') as directory:
            root = Path(directory)
            setup = root / 'AMARA-Downloader-Setup-2.8.10.exe'
            setup.write_bytes(b'MZ-fixture')
            validation, output = root / 'validation.json', root / 'amara-update.json'
            for results in [[], [{'test': 'regression', 'passed': False}]]:
                validation.write_text(json.dumps(results))
                with self.assertRaises(ValueError):
                    builder.write_update_manifest(setup, '2.8.10', validation, output)
                self.assertFalse(output.exists())
            validation.write_text(json.dumps([{'test': 'regression', 'passed': True}]))
            builder.write_update_manifest(setup, '2.8.10', validation, output)
            data = json.loads(output.read_text())
            self.assertEqual(data['validation'], {'passed': True, 'testFiles': 1})
            self.assertEqual(data['sha256'], hashlib.sha256(setup.read_bytes()).hexdigest())

    def test_staged_update_preserves_portable_profile(self):
        with tempfile.TemporaryDirectory(prefix='amara-update-check-') as directory:
            root = Path(directory)
            for folder in ['tools', 'artifacts', 'source', 'Hongguo English/resources',
                           'release/AMARA-Downloader-v2.8.7-Windows-Portable/resources/english-user-data']:
                (root / folder).mkdir(parents=True, exist_ok=True)
            script = root / 'tools/apply-pending-update.py'
            script.write_bytes((ROOT / 'tools/apply-pending-update.py').read_bytes())
            (root / 'source/package.json').write_text('{"version":"2.8.7"}')
            pending = root / 'artifacts/pending-update.asar'
            pending.write_bytes(b'fixed-package')
            original = root / 'Hongguo English/resources/app.asar'
            portable = root / 'release/AMARA-Downloader-v2.8.7-Windows-Portable/resources/app.asar'
            profile = portable.parent / 'english-user-data/media-browser.json'
            original.write_bytes(b'original-package')
            portable.write_bytes(b'portable-package')
            profile.write_bytes(b'personal-queue')
            with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='"AMARA Downloader.exe","1"\n')):
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(script))
            self.assertEqual(portable.read_bytes(), b'portable-package', 'Never update a running app')
            with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0, stdout='')):
                runpy.run_path(str(script))
            self.assertEqual(original.read_bytes(), b'fixed-package')
            self.assertEqual(portable.read_bytes(), b'fixed-package')
            self.assertEqual(profile.read_bytes(), b'personal-queue')
            self.assertEqual((root / 'backups/portable-2.8.7.before-thumbnail-fix.asar').read_bytes(), b'portable-package')
            self.assertFalse(pending.exists())

    def test_manifest_removes_only_packaged_files(self):
        with tempfile.TemporaryDirectory(prefix='amara-build-check-') as directory:
            root = Path(directory)
            runtime = root / 'runtime'
            (runtime / 'resources/bin').mkdir(parents=True)
            (runtime / 'resources/app.asar').write_bytes(b'package')
            (runtime / 'resources/bin/ffmpeg.exe').write_bytes(b'MZ')
            (runtime / 'price$1.txt').write_text('fixture')
            manifest = root / 'uninstall.nsh'
            builder.write_uninstall_manifest(runtime, manifest)
            text = manifest.read_text(encoding='utf-8')
            self.assertIn('price$$1.txt', text)
            self.assertNotIn('RMDir /r', text)
            self.assertNotIn('english-user-data', text)
            self.assertLess(text.index('Delete '), text.index('RMDir '))
            (runtime / 'resources/english-user-data').mkdir()
            with self.assertRaisesRegex(ValueError, 'personal data'):
                builder.write_uninstall_manifest(runtime, manifest)

    def test_uninstaller_keeps_unlisted_user_files(self):
        source = (ROOT / 'tools/installer.nsi').read_text(encoding='utf-8')
        uninstall = source.split('Section "Uninstall"', 1)[1]
        self.assertNotIn('RMDir /r "$INSTDIR"', uninstall)
        self.assertIn('!include "${UNINSTALL_FILES}"', uninstall)


if __name__ == '__main__':
    unittest.main()
