"""Restore private build settings from an encrypted GitHub Actions secret."""
from pathlib import Path
import json
import os
import re

ROOT = Path(__file__).resolve().parents[1]
config = json.loads(os.environ['AMARA_PRIVATE_BUILD_CONFIG'])
provider, secret = config['providerConfiguration'], config['licenseSecret']
if not isinstance(provider, dict) or not isinstance(secret, str) or len(secret) < 16:
    raise ValueError('Invalid private build configuration')
(ROOT / 'source/src/pro-config.json').write_text(json.dumps(provider, indent=2), encoding='utf-8')
for relative in ['source/pro/license-manager.js', 'source/src/native/license-validator.js']:
    file = ROOT / relative
    contents, count = re.subn(r'([\'"])CONFIGURE_PRIVATE_LICENSE_SECRET\1', lambda _: json.dumps(secret), file.read_text(encoding='utf-8'))
    if count != 1:
        raise ValueError('Expected one private license placeholder in ' + relative)
    file.write_text(contents, encoding='utf-8')
print('Private build settings restored; values were not logged.')
