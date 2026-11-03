# AMARA updates

The AMARA update channel is `cheudara-hub/amara-downloader`. Hongguo upstream is `jackotom/hongguo-drama`. These have separate version tracks: an upstream 5.x release is not an AMARA 2.x installer.

AMARA checks when opened and every six hours while running. Open **Updates** for the integrated upstream version, latest release, last successful check, and the tested AMARA release link. **Check now** retries immediately. The existing automatic-update preference in Settings disables checks. Downloads and installation remain explicit user actions from the release page.

The repository's scheduled workflow fetches current upstream source every six hours and attaches a comparison diff under Actions. `Check Hongguo Updates.cmd` does the same locally and runs the current app's regression checks. Downloaded source is never executed or automatically applied. Existing AMARA customizations appear in the diff; they are not necessarily upstream changes.

After compatibility review and integration, update `source/update-channel.json`'s integrated upstream version, bump `source/package.json`, and update `docs/RELEASE-CURRENT.md`. A matching version tag runs the Windows release workflow. All active regression checks must pass before packaging or publishing. The builder creates the setup EXE, SHA-256 file, and `amara-update.json`. AMARA offers an own-channel release only after validating its product/version/platform, installer asset and successful-test metadata. Metadata is trusted from the configured repository; it is not an independent security certification.

CI uses a checksum-pinned runtime from the bootstrap prerelease `build-runtime-v1`. It has no app archive or user profile. Public source has private provider and license values replaced with placeholders. The `AMARA_PRIVATE_BUILD_CONFIG` encrypted Actions secret restores those values only during a release build. Never commit this secret, local configuration payloads, license-admin files, profiles, queues, media, or build logs.

To publish a reviewed version, push its source and a matching tag such as `v2.8.10`. The published build is available from Releases. Upstream discovery is automated; compatibility fixes still require engineering review. No update system can guarantee that every provider or episode stays available.

An existing successful main-branch Windows build can also be published with the **Publish an existing tested AMARA build** workflow. Supply its run ID. This verifies the source repository/workflow/commit, test report, product/version, installer checksum, and matching source package version before publication. Existing releases are not overwritten.
