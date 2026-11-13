/** Owner, Nov 9, 2026: the client summary is edited with formatting; email and copy keep its shape. */
import { describe, expect, it } from 'vitest';
import { isSummaryHtml, summaryEditorHtml, summaryEmailHtml, summaryPlainText } from './clientSummaryHtml';
import { summaryPlaceholder } from './idexxClientSummaryDraft';

const draft = 'Dear Maria,\n\nJuniper is mostly fine.\n\n- High: Glucose 312\n- Low: Potassium\n\nNext steps: [doctor to add]';

describe('client summary formats', () => {
  it('opens an AI draft in the editor as paragraphs and a bullet list', () => {
    const html = summaryEditorHtml(draft);
    expect(html).toBe(
      '<p>Dear Maria,</p><p>Juniper is mostly fine.</p><ul><li>High: Glucose 312</li><li>Low: Potassium</li></ul><p>Next steps: [doctor to add]</p>'
    );
    expect(isSummaryHtml(html)).toBe(true);
    expect(isSummaryHtml(draft)).toBe(false);
  });

  it('turns edited HTML back into plain text for copying and the placeholder check', () => {
    const edited = '<p>Dear Maria,</p><p>Juniper is <strong>mostly</strong> fine.</p><ul><li>High: Glucose 312</li></ul><p>Next steps: [doctor to add]</p>';
    const text = summaryPlainText(edited);
    expect(text).toBe('Dear Maria,\n\nJuniper is mostly fine.\n\n- High: Glucose 312\n\nNext steps: [doctor to add]');
    expect(summaryPlaceholder(text)).toBe('[doctor to add]');
    expect(summaryPlaceholder(summaryPlainText(edited.replace('[doctor to add]', 'recheck in two weeks')))).toBeNull();
  });

  it('keeps the formatting in the email, with the email styles', () => {
    const html = summaryEmailHtml('<p>Hi <strong>Maria</strong></p><ul><li>One</li></ul><script>alert(1)</script>');
    expect(html).toContain('<strong>Maria</strong>');
    expect(html).toMatch(/<p style="[^"]*font-size:15px/);
    expect(html).toMatch(/<li style="/);
    expect(html).not.toContain('<script');
  });

  it('still styles a plain-text summary for the email', () => {
    expect(summaryEmailHtml('Hi Maria,\n\n- One')).toMatch(/<p style=.*>Hi Maria,<\/p><ul style=.*><li style=.*>One<\/li><\/ul>/);
  });
});
