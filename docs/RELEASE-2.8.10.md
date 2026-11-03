# AMARA Windows 2.8.10

- Adds an Updates button with automatic checks on startup and every six hours, an immediate retry, and separate AMARA/upstream version information.
- Connects tested AMARA releases to `cheudara-hub/amara-downloader`. Upstream binaries no longer appear as installable AMARA updates. Own-channel updates require valid release metadata and installer assets.
- Adds a scheduled GitHub upstream source checker and a local `Check Hongguo Updates.cmd` source/diff preparation command. Downloaded source is not executed or automatically applied.
- Windows builds produce SHA-256 and update metadata only after active regression checks pass. Public repository exports exclude private configuration and profiles; release CI restores private build settings from an encrypted secret.
- Retains the Hongguo batch recovery fix verified with eight desktop episode downloads in 2.8.9.

Updates open the verified release page for explicit download/install. Compatibility review is still required before new upstream code becomes an AMARA release.
