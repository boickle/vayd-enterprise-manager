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
- **Final voice:** OpenAI `gpt-4o-mini-tts`, voice Nova. The key lives in the macOS Keychain item `openai-tts`:
  `security add-generic-password -a "$USER" -s openai-tts -w "$(pbpaste)"` (copy the key first).
- **Dry runs:** any Mac voice, free, for example `Samantha`.

## Make a video

```bash
export API_DIR=~/worktrees/<vayd-api checkout on build-doctor-flow>
bash cypress/training/stack/stack-up.sh       # fresh DB, demo names, API :3210, app :5210

# Dry run (free voice): check run.log and the frames, fix, repeat.
bash cypress/training/record.sh emr-v6-wrap-up Samantha ~/.vayd-training/v6-dry.mp4

# Final take
bash cypress/training/record.sh emr-v6-wrap-up openai:nova "$HOME/Movies/VAYD Training/EMR V6 - Wrap-up, recap and signing.mp4"

bash cypress/training/stack/stack-down.sh
```

Each video is one spec plus one narration file with the same name:
- `<name>.cy.ts`: the setup before `startClock()`, then one `line()` per narration line;
- `narration/<name>.json`: `[{ id, text }]`.

`record.sh` writes everything to `~/.vayd-training/<name>/`:
- `run.log`;
- `marks.json`, holding each line's start time and every click time;
- `frames/`, one frame every 10 s.

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
- **After a take, compare click times to line starts.** `marks.json` has both. Every click should land within about
  1.5 s of the line that names it.

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
8. Dry run with a free Mac voice. Check the whole screen is visible, nothing hides under sticky headers, and
   click times match their lines (marks.json). Send me questions and proposed changes before the final take.
9. Reset the data, then record the final take with Nova (no captions). Save it to ~/Movies/VAYD Training/,
   show me 3–4 frames, and list anything that looks like a bug. Don't change product code, commit or push
   without asking.
```

To keep cost down:
- start a new session for each video;
- ask for at most 4–6 frames to be checked;
- use Sonnet to re-record a scene that already works.
