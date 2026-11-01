import { describe, expect, it } from 'vitest';
import {
  createBlock,
  createDefaultDesign,
  EmailDesign,
  isValidLink,
  parseDesign,
  previewMergeTags,
  renderDesignToHtml,
  stripUnsafeHtml,
} from './emailDesign';
import { campaignChecks, unknownMergeTags } from './campaignChecks';

function design(blocks: EmailDesign['blocks']): EmailDesign {
  return { ...createDefaultDesign(), blocks };
}

describe('renderDesignToHtml', () => {
  it('builds a full table-based document with every block', () => {
    const html = renderDesignToHtml(
      design([
        {
          ...createBlock('heading'),
          text: 'Hello <b>{{first_name}}</b>',
        } as EmailDesign['blocks'][number],
        createBlock('text'),
        {
          ...createBlock('image'),
          src: 'https://cdn.example.com/a.png',
          alt: 'A dog',
          href: 'https://vayd.com',
        } as EmailDesign['blocks'][number],
        {
          ...createBlock('button'),
          href: 'https://vayd.com/book',
          label: 'Book',
        } as EmailDesign['blocks'][number],
        createBlock('divider'),
        createBlock('spacer'),
        {
          ...createBlock('html'),
          html: '<p class="custom">Raw</p>',
        } as EmailDesign['blocks'][number],
      ]),
      'Subject'
    );
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>Subject</title>');
    expect(html).toContain('Hello &lt;b&gt;{{first_name}}&lt;/b&gt;');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('alt="A dog"');
    expect(html).toContain('href="https://vayd.com/book"');
    expect(html).toContain('<p class="custom">Raw</p>');
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('{{practice_name}}');
  });

  it('drops unsafe links and empty images', () => {
    const html = renderDesignToHtml(
      design([
        { ...createBlock('button'), href: 'javascript:alert(1)' } as EmailDesign['blocks'][number],
        createBlock('image'),
      ])
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
  });

  it('styles rich text paragraphs and links inline', () => {
    const html = renderDesignToHtml(
      design([
        {
          ...createBlock('text'),
          html: '<p>Hi <a href="https://x.com">there</a></p>',
        } as EmailDesign['blocks'][number],
      ])
    );
    expect(html).toContain('<p style="margin:0 0 16px;">');
    expect(html).toMatch(/<a href="https:\/\/x.com" style="color:#0f766e;/);
  });
});

describe('helpers', () => {
  it('parses stored designs and rejects junk', () => {
    expect(parseDesign(null)).toBeNull();
    expect(parseDesign({ version: 2, blocks: [] })).toBeNull();
    const d = parseDesign({
      version: 1,
      blocks: [createBlock('text'), { nope: true }],
      settings: { textColor: '#000' },
    });
    expect(d?.blocks).toHaveLength(1);
    expect(d?.settings.textColor).toBe('#000');
    expect(d?.settings.linkColor).toBeTruthy();
  });

  it('validates links', () => {
    expect(isValidLink('https://vayd.com/x')).toBe(true);
    expect(isValidLink('https://')).toBe(false);
    expect(isValidLink('vayd.com')).toBe(false);
    expect(isValidLink('mailto:hi@vayd.com')).toBe(true);
    expect(isValidLink('https://vayd.com/{{first_name}}')).toBe(true);
  });

  it('fills sample merge values and strips scripts for preview', () => {
    expect(previewMergeTags('Hi {{first_name}} {{unknown|friend}}')).toBe('Hi Alex friend');
    expect(
      stripUnsafeHtml('<p onclick="x()">a</p><script>bad()</script><iframe src="x"></iframe>')
    ).toBe('<p>a</p>');
  });
});

describe('campaignChecks', () => {
  const base = {
    subject: 'Hello {{first_name}}',
    preheader: 'Hi',
    html: '<p>Body</p>',
    editorMode: 'design' as const,
    goal: { type: 'appointment_booked' as const, windowDays: 30, appointmentTypeIds: [] },
  };
  const summary = { total: 10, eligible: 8, excluded: { recent_pet_loss: 2 }, sample: [] };

  it('passes a complete campaign', () => {
    const d = design([
      { ...createBlock('button'), href: 'https://vayd.com' } as EmailDesign['blocks'][number],
    ]);
    const checks = campaignChecks(base, d, summary);
    expect(checks.filter((c) => c.blocking && !c.ok)).toEqual([]);
  });

  it('blocks on missing subject, unknown tags, bad buttons and an empty audience', () => {
    const d = design([createBlock('button')]);
    const checks = campaignChecks({ ...base, subject: '', html: '<p>Hi {{frist_name}}</p>' }, d, {
      ...summary,
      eligible: 0,
    });
    const failing = checks.filter((c) => c.blocking && !c.ok).map((c) => c.label);
    expect(failing).toEqual([
      'Subject line is set',
      'Unknown merge tag: {{frist_name}}',
      '1 button needs a link',
      '0 clients will receive it',
    ]);
  });

  it('finds unknown merge tags', () => {
    expect(unknownMergeTags('{{first_name}} {{pet_names|your pet}} {{nope}}')).toEqual(['nope']);
  });
});
