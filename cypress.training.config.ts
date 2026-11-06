/**
 * Training videos: the normal Cypress config plus narration timing. Run against a TEST stack only.
 *
 *   TRAINING_NARRATION=<narration.json> TRAINING_OUT=<folder> \
 *     npx cypress run --config-file cypress.training.config.ts --spec cypress/training/<scene>.cy.ts
 *
 * narration.json = [{ id, text, ms }] (ms = length of that line's recorded voice). The spec shows each line as a
 * caption and stays on it at least that long; the times each line starts are written to <folder>/marks.json so
 * the voice can be laid over the video afterwards.
 */
import { defineConfig } from 'cypress';
import * as fs from 'fs';
import * as path from 'path';
import base from './cypress.config';

const out = process.env.TRAINING_OUT || path.join(process.cwd(), 'cypress', 'training-out');

export default defineConfig({
  ...base,
  e2e: {
    ...base.e2e,
    specPattern: 'cypress/training/**/*.cy.ts',
    video: true,
    videoCompression: false,
    videosFolder: path.join(out, 'videos'),
    screenshotsFolder: path.join(out, 'screenshots'),
    defaultCommandTimeout: 30000,
    // Clicks and typing scroll their target to the middle, not under the sticky headers, so the cursor stays on it.
    scrollBehavior: 'center',
    // Bigger than the test default so the planner window and its edges fit with room around them.
    viewportWidth: 1600,
    viewportHeight: 900,
    async setupNodeEvents(on, config) {
      const cfg = (await base.e2e!.setupNodeEvents!(on, config)) || config;
      let zero = 0;
      const marks: Record<string, number> = {};
      const clicks: number[] = [];
      /** Stretches to cut out of the final video (a page reload, a slow save): [start, end] ms. */
      const cuts: [number, number][] = [];
      on('task', {
        trainingNarration() {
          const file = process.env.TRAINING_NARRATION;
          if (!file) throw new Error('Set TRAINING_NARRATION to the narration.json file');
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        },
        trainingFrame(rect: Record<string, number>) {
          marks.__frame = rect as any;
          return null;
        },
        trainingZero() {
          zero = Date.now();
          return null;
        },
        trainingMark(id: string) {
          marks[id] = Date.now() - zero;
          return null;
        },
        /** A click (or drop) happens now: the video gets a click sound here. */
        trainingCut(edge: 'start' | 'end') {
          if (edge === 'start') cuts.push([Date.now() - zero, Date.now() - zero]);
          else if (cuts.length) cuts[cuts.length - 1][1] = Date.now() - zero;
          return null;
        },
        trainingClick() {
          clicks.push(Date.now() - zero);
          return null;
        },
        /** Milliseconds since the line `id` started. */
        trainingSince(id: string) {
          return Date.now() - zero - (marks[id] ?? 0);
        },
        trainingSave() {
          fs.mkdirSync(out, { recursive: true });
          fs.writeFileSync(path.join(out, 'marks.json'), JSON.stringify({ ...marks, __clicks: clicks, __cuts: cuts }, null, 2));
          return null;
        },
      });
      // A window big enough that the app is shown at 100% beside Cypress's own panel; the video is cropped to the app.
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.name === 'electron') {
          launchOptions.preferences.width = 2300;
          launchOptions.preferences.height = 1150;
        }
        return launchOptions;
      });
      return cfg;
    },
  },
});
