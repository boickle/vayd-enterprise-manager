/** T-B11: the "Also close it for …?" and "Reopen this task?" windows open above the top bar, not under it. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(resolve(__dirname, name), 'utf8');

/** z-index of the last rule for `selector` that sets one (media-query copies of a rule can come first). */
function zIndexOf(source: string, selector: string): number {
  const found: number[] = [];
  let start = source.indexOf(`${selector} {`);
  while (start >= 0) {
    const body = source.slice(start, source.indexOf('}', start));
    const match = body.match(/z-index:\s*(-?\d+)/);
    if (match) found.push(Number(match[1]));
    start = source.indexOf(`${selector} {`, start + 1);
  }
  if (!found.length) throw new Error(`no z-index in ${selector}`);
  return found[found.length - 1];
}

describe('shared task prompts sit above the top bar (T-B11)', () => {
  it('T-B11-1: the prompt backdrop is above the schedule-shell top bar (100) and the sticky navbar (10)', () => {
    const prompts = zIndexOf(css('SharedTaskPrompts.css'), '.shared-task-prompt__backdrop');
    const topBar = zIndexOf(css('../../styles.css'), '.navbar.navbar--schedule-shell');
    const stickyNavbar = zIndexOf(css('../../styles.css'), '.navbar');

    expect(prompts).toBeGreaterThan(topBar);
    expect(prompts).toBeGreaterThan(stickyNavbar);
  });

  it('T-B11-1: the prompt backdrop matches the reassign modal layer', () => {
    const prompts = zIndexOf(css('SharedTaskPrompts.css'), '.shared-task-prompt__backdrop');
    const reassign = zIndexOf(css('TaskReassignModal.css'), '.task-reassign-modal__backdrop');
    expect(prompts).toBe(reassign);
  });
});
