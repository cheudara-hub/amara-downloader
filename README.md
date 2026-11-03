# AMARA Downloader

Customized Hongguo desktop downloader with upstream release monitoring, batch recovery, and tested Windows releases.

- [Download tested AMARA releases](https://github.com/cheudara-hub/amara-downloader/releases/latest)
- [How updates work](docs/UPDATES.md)
- [Hongguo upstream](https://github.com/jackotom/hongguo-drama)

Upstream checks run every six hours. New source is downloaded as a review artifact; it is not automatically executed or merged. Reviewed AMARA changes are validated by regression tests before tagged Windows releases are published. Passing tests cannot guarantee live provider availability.

Public source excludes provider credentials, license signing material, user profiles, queues, and media. Build settings are injected from encrypted GitHub Actions secrets. Contributors can run offline regression tests with synthetic configuration; production builds require the repository owner's private configuration. Licensed platform access is still required where applicable.

See LICENSE, NOTICE, THIRD-PARTY-NOTICES.md and docs/MODIFICATIONS.txt for upstream attribution. This modified edition is distributed under GPL-3.0.
