# Di.Verse v1.11.0

## Highlights

- Spoken translation selection is built from the locally installed Bible catalogue instead of a short hard-coded list.
- The parser recognises installed translation codes, full names and supported spoken aliases while guarding common sermon phrases against accidental edition switches.
- Whisper's transcription prompt is generated from the installed translation catalogue, so imported editions are included in recognition hints.
- The full-catalogue QA checks translation switching, spoken scripture references and retrieval of the exact locally stored translation without silent KJV fallback.
- The test runner now uses separate disposable database copies for the clean integration suite and the full-catalogue spoken QA.
- Server integration tests use dynamically allocated ports and explicit startup checks.
- The Mac app launcher now detects an older running server and requests a clean stop before starting the upgraded app.
- Developer setup instructions now point to the stable main branch.

## Validation

- Clean automated test suite: 108 passed, 0 failed, 1 intentionally skipped in the developer's local run.
- Full local-catalogue spoken QA: all 57 installed translations passed in the developer's local run.
- The clean CI database intentionally contains only the six distributable starter translations. The full 57-version QA is skipped in CI unless a full local catalogue is present; no user-imported Bible database is copied into CI or release packages.

## Installer contents and platform notes

- Fresh installers include KJV, ASV, YLT, BBE, BSB and WEB.
- User-imported Bible translations, keys and songs remain in the user's external data folder and are not included in the distributable installer.
- The Mac app targets macOS 11.0 or newer and is not Apple-signed/notarized in this release workflow. On first launch, macOS may require the user to approve opening it in Privacy & Security.
- The Windows installer targets 64-bit Windows. Real church-network and physical Focusrite/mixer testing remains a deployment check, not something simulated by the automated build.

## Separate work not included

The draft sermon-audio / Windows audio-bridge branch is not part of this release candidate. Its two-computer church setup still requires physical validation.
