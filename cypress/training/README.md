# Narrated training videos

Cypress drives the app on an isolated TEST stack at a watchable pace, with a large cursor and an orange outline on
everything it points at or clicks. A voice reads the narration, and ffmpeg lays the voice and a click sound over the
recording. Each video ends up in `~/Movies/VAYD Training/`.

Nothing on this stack can reach a real client:
- the database is `vayd_api_test_e2e`, a fresh copy of `vayd_api_test_base`;
- Stripe and routing are fakes;
- email is captured to a file;
- the SMS and Gmail keys are blank;
- scheduled jobs are off.

## One-time setup

- `brew install ffmpeg`
- **Voice:** OpenAI `gpt-4o-mini-tts`, voice Nova. The key lives in the macOS Keychain item `openai-tts`:
  `security add-generic-password -a "$USER" -s openai-tts -w "$(pbpaste)"` (copy the key first).
  Clips are cached by their text in `~/.vayd-training/voice-cache`, so a re-take only pays for lines that changed.
  Use Nova for dry runs too: the timing then matches the final video, and a clean dry run *is* the final video.

## Make a video

```bash
export API_DIR=~/worktrees/<vayd-api checkout on build-doctor-flow>
bash cypress/training/stack/stack-up.sh       # fresh DB, demo names, API :3210, app :5210
# A second stack alongside another session: set the variables in stack/stack-env.sh first
# (TRAINING_DB, TRAINING_API_PORT, TRAINING_APP_PORT, TRAINING_STRIPE_PORT, TRAINING_OSRM_PORT,
# TRAINING_REDIS_DB, TRAINING_WORK). record.sh and stack-down.sh read the same variables.
# TRAINING_SMS_CAPTURE=1 records texts in $TRAINING_WORK/stack/sms.jsonl instead of failing.

# Record straight to the final file. Fix and repeat until it passes and the clicks are in sync.
bash cypress/training/record.sh emr-v6-wrap-up openai:nova "$HOME/Movies/VAYD Training/EMR V6 - Tech, DVM - Wrap-up, recap and signing.mp4"

bash cypress/training/stack/stack-down.sh
```

Finished videos play at **1.25×** (the voice keeps its pitch); set `TRAINING_SPEED=1` for normal speed. Name the
file: video number, then who should watch it (`CL`, `Tech`, `DVM`, or a list such as `CL, Tech, DVM`), then
the description. For example: `LV-01 - Tech, DVM - Run an in-house lab in the visit.mp4`.

Each video is one spec plus one narration file with the same name:
- `<name>.cy.ts`: the setup before `startClock()`, then one `line()` per narration line;
- `narration/<name>.json`: `[{ id, text }]`.

`record.sh` writes everything to `~/.vayd-training/<name>/`:
- `run.log`;
- `marks.json`, holding each line's start time and every click time;
- `frames/`, one small frame every 10 s;
- `fail.jpg`, a small screenshot of the app when a run fails.

It prints only what's needed: on failure the error lines and `fail.jpg`; on success whether every click lands within
2 s of its line. It restarts the stack itself when the sign-in tokens (4 h) are over 3.5 h old.

## Rules that keep sound and picture together

- **One action per narration line.** A line's actions start when its voice starts, so the voice should be naming what
  is being clicked. Split "…so click Don't email, say why, and record it" into three lines: "So click Don't email," /
  "say why," / "and record it."
- **Put the "why" in its own line**, with no clicks under it.
- **When a line has a click, say the action first**, and put any explanation after it in the same line. For example:
  "One click signs and locks both charts. Only a licensed veterinarian can sign."
- **Use `tap`, `pointAt`, `typeSlowly` and `drag` from `trainingKit.ts`. Never a bare `.click()`.** They scroll the
  target to the middle of the screen, rest the cursor on it, outline it, then click with a ripple and a click sound.
- **Open things up to show what they do**, for example a pet card's four SOAP sections, then close them again.
- **Never mention something the viewer can't see.** Either set up data that shows it, or cut the sentence.
- **After a take, read the click line `record.sh` prints.** Every click should land within 2 s of the line that names
  it (taps land about 1.6 s in). It lists any late ones.

## Demo data

`stack/demo-names.sh` renames the seeded world:
- the Rivera household: Maria; Maple, Juniper and Pepper;
- the Chen household: Tom and Biscuit;
- staff: Dr. Avery Lane (licensed), Dr. Priya Shah, Jordan Pike, Casey Morgan and Robin Hale;
- zone North;
- example.com emails;
- an Office exam catalog item.

Each spec adds what its story needs in its setup (visits, charts, reminders) and clears what an earlier take left
behind.

If real records are copied in to make a screen look lived-in, follow these rules:
- **Read-only from `vayd_api_local`; write only to a `*test*` database.**
- **Replace everything identifying:** client and pet names, phones, emails, addresses (fake addresses inside a real
  zone) and any names in free text.
- **Shift dates** so reminders fall due around the recording date.
- **Check every dry-run frame** for anything real before the final take.

## Prompt for a new session

```
Make the narrated training video for <video ID and name> from <script path>, following
cypress/training/README.md on the training/videos branch (FE) with the API on build-doctor-flow.
Audience: <CLs / techs / doctors>, about <2–4> minutes, one task.
The one thing they must remember: <…>. Say it near the start and again at the end.
Also show: <other roles, e.g. what a tech sees when the sign button is greyed out>.

1. Check the script against the current code. Fix anything out of date, missing or confusing, and list what
   you changed. If a screen looks half-built or about to change, tell me before recording it.
2. Open with one or two sentences of "why" (for example, forward booking secures future bookings, shortens
   drives and, above all, gives our patients the best care). Be brief, but explain what each part does and
   what else the viewer can do there (for example, add problems, medications or callbacks).
3. Start on the screen before this one if knowing how to get here matters; otherwise start on the screen itself.
4. Show each part working: open or expand sections so viewers see what they do. Don't just point at a summary.
5. Keep sound and picture together. Write one action per narration line, so each click happens while the voice
   names it. Every click and field gets the big cursor, the outline and the click sound. Never narrate something
   that isn't on screen.
6. Use the same demo family as the other videos (the Riveras; the Chens for a second household). If a screen
   needs to look lived-in, copy real records read-only from vayd_api_local into the test database and
   anonymize them as the README says.
7. End with the script's most common mistake or two, in one closing line, then the one thing to remember.
8. Record with Nova straight to ~/Movies/VAYD Training/ (no captions); voice clips are cached, so re-takes
   are cheap. Fix and re-record until it passes and record.sh reports the clicks in sync. Check 3 small
   frames (whole screen visible, nothing under sticky headers, no leftovers from earlier takes).
9. List anything that looks like a bug. Don't change product code, commit or push without asking.
```

To keep cost down:
- start a new session for each video (a long session re-reads its whole history on every step);
- Sonnet is enough for most videos once the script is checked; use Opus for the script check on a new area;
- grep the app for the exact selectors and labels before writing the spec, instead of learning them from
  failed runs;
- look at `fail.jpg` and the 800-px frames, never the full-size screenshots;
- check 3 frames, not every one.
