# Notes for AI agents (Cursor, Claude)

## Merging branches

- When merging `main` into `build-doctor-flow`, `main` still carries an older 12k-line hardcoded client Room Loader form. For conflicts in `src/pages/PublicRoomLoaderForm.tsx` and `src/components/MembershipRecommendationPanel.tsx`, keep this branch's file (`git checkout --ours <file>`). Then list what `main` changed in it (`git log <merge-base>..main -- <file>`) and port only those changes by hand. Never take main's whole file. The form is driven by Settings → Room Loader through `src/utils/roomLoaderOfferEngine.ts`, and merge `6895bcd` (Oct 26, 2026) undid that rebuild by taking main's side.
- After any merge, run `git diff --stat HEAD^1 HEAD` and look into any file that changed by thousands of lines.
- Run `npm test` before pushing a merge. `src/pages/roomLoaderFormGuard.test.ts` fails if the settings-driven form was replaced. Don't edit its expectations to make it pass.
