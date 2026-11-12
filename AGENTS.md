# Notes for AI agents (Cursor, Claude)

## Merging branches

- When merging `main` into `build-doctor-flow`, `main` still carries an older 12k-line hardcoded client Room Loader form. For conflicts in `src/pages/PublicRoomLoaderForm.tsx` and `src/components/MembershipRecommendationPanel.tsx`, keep this branch's file (`git checkout --ours <file>`). Then list what `main` changed in it (`git log <merge-base>..main -- <file>`) and port only those changes by hand. Never take main's whole file. The form is driven by Settings → Room Loader through `src/utils/roomLoaderOfferEngine.ts`, and merge `6895bcd` (Oct 26, 2026) undid that rebuild by taking main's side.
- After any merge, run `git diff --stat HEAD^1 HEAD` and look into any file that changed by thousands of lines.
- Run `npm test` before pushing a merge. `src/pages/roomLoaderFormGuard.test.ts` fails if the settings-driven form was replaced. Don't edit its expectations to make it pass.

## One codebase: app fixes go on `build-doctor-flow`

This applies to both repos, vayd-enterprise-manager and vayd-api.

- **App fixes:** make every app code fix (`src/`, API code, migrations) on `build-doctor-flow`, even one found while recording a training video or running the demo.
- **Training and demo branches** (`training/*` here, `emr/demo` in vayd-api) hold only training and demo files: `cypress/training/`, `docs/training/`, `cypress.training.config.ts` and demo seed scripts. Never commit app code there.
- **Fixes found in a training or demo worktree:** commit them on `build-doctor-flow`, then merge `build-doctor-flow` into the training branch.
- **Before recording training videos,** merge `build-doctor-flow` into the training branch, so the videos show the screens that will ship.
- **The demo stack** runs this same code against its own test database. Only its data is separate.

## Help topics (the Help page and the Help assistant)

- Help topics are markdown files in `vayd-api/src/scribe/help/`. The Help page shows them with their training videos, and the Help assistant answers from them.
- **Update the matching topic in the same change** when a change renames a button, moves a screen, or changes a workflow staff use. Find it with `grep -l "<web-app file path>" vayd-api/src/scribe/help/*.md` (each topic lists the web-app files it describes under `covers:`), then set `reviewed:` to today.
- If the change makes a training video show an old screen or button name, add or update `video_note:` (for example: "Recorded before … was renamed …"). Re-recording is the owner's call.
- New video: add `video:` (S3 key under `training-videos/`) and `video_source:` (just the video's code, e.g. `INV-01`, or its file name in `~/Movies/VAYD Training`; with a code, adding "FINAL" to the file name doesn't break the upload), then upload with `npm run help:videos` in vayd-api, once per environment. At go-live, run `npm run help:videos -- --check` against production.
