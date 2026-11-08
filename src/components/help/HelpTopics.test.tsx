import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelpArticle } from '../../api/scoutHelp';
import { parseHelpMarkdown } from './helpMarkdown';

const api = vi.hoisted(() => ({
  fetchHelpArticles: vi.fn(),
  fetchHelpVideoUrl: vi.fn(),
  fetchHelpGaps: vi.fn(),
  removeHelpGap: vi.fn(),
}));
vi.mock('../../api/scoutHelp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/scoutHelp')>()),
  ...api,
}));

import HelpTopics, { filterHelpArticles } from './HelpTopics';
import AssistantAnswer from './AssistantAnswer';
import { splitTopicLinks } from '../../api/scoutHelp';

const article = (over: Partial<HelpArticle>): HelpArticle => ({
  slug: 'x',
  title: 'X',
  module: 'EMR',
  order: 1,
  roles: [],
  reviewed: '2026-11-07',
  keywords: [],
  body: 'Body',
  hasVideo: false,
  videoNote: null,
  ...over,
});

const rx = article({
  slug: 'emr-10-prescriptions',
  title: 'Prescriptions: directions, approval and the label',
  roles: ['Doctors', 'Techs'],
  keywords: ['print label', 'bluetooth'],
  body: '## Steps\n1. Click **Print label**.\n   - **Print on DYMO**, or\n   - **Use system print dialog**\n2. Done.',
  hasVideo: true,
  videoNote: 'Recorded before the rename.',
});
const vitals = article({
  slug: 'emr-02-vitals-exam',
  title: 'Vitals and the exam',
  keywords: ['weight'],
});
const start = article({ slug: 'practice-chat', title: 'Using Help', module: 'Getting started' });

describe('parseHelpMarkdown', () => {
  it('reads headings, numbered steps with nested bullets, and paragraphs', () => {
    expect(
      parseHelpMarkdown('Intro line\n\n## Steps\n1. One\n   - a\n   - b\n2. Two\n\n- Tip')
    ).toEqual([
      { kind: 'p', text: 'Intro line' },
      { kind: 'h', text: 'Steps' },
      {
        kind: 'ol',
        items: [
          { text: 'One', children: ['a', 'b'] },
          { text: 'Two', children: [] },
        ],
      },
      { kind: 'ul', items: [{ text: 'Tip', children: [] }] },
    ]);
  });
});

describe('filterHelpArticles', () => {
  it('needs every word, across title, keywords and text', () => {
    expect(filterHelpArticles([rx, vitals], 'bluetooth label').map((a) => a.slug)).toEqual([
      'emr-10-prescriptions',
    ]);
    expect(filterHelpArticles([rx, vitals], '')).toHaveLength(2);
    expect(filterHelpArticles([rx, vitals], 'refund')).toEqual([]);
  });
});

describe('HelpTopics', () => {
  beforeEach(() => {
    api.fetchHelpArticles.mockResolvedValue([start, vitals, rx]);
    api.fetchHelpVideoUrl.mockResolvedValue('https://example.test/v.mp4');
  });

  it('lists topics by area and opens one with its video and steps', async () => {
    render(
      <MemoryRouter>
        <HelpTopics />
      </MemoryRouter>
    );
    expect(await screen.findByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('EMR')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search help topics'), {
      target: { value: 'bluetooth' },
    });
    expect(screen.queryByText('Vitals and the exam')).toBeNull();

    fireEvent.click(screen.getByText('Prescriptions: directions, approval and the label'));
    expect(screen.getByRole('heading', { name: /Prescriptions/ })).toBeInTheDocument();
    expect(screen.getByText('For: Doctors, Techs')).toBeInTheDocument();
    expect(screen.getByText('Use system print dialog')).toBeInTheDocument();
    expect(screen.getByText('Recorded before the rename.')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'https://example.test/v.mp4'
      )
    );
    expect(api.fetchHelpVideoUrl).toHaveBeenCalledWith('emr-10-prescriptions');

    // Back keeps the search, so the list still shows only the matching topic.
    fireEvent.click(screen.getByText('All topics'));
    expect(
      screen.getByText('Prescriptions: directions, approval and the label')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Search help topics')).toHaveValue('bluetooth');
  });

  it('opens a topic from the link and says when its video is not uploaded', async () => {
    api.fetchHelpVideoUrl.mockRejectedValue(new Error('404'));
    render(
      <MemoryRouter initialEntries={['/schedule/help?topic=emr-10-prescriptions']}>
        <HelpTopics />
      </MemoryRouter>
    );
    expect(await screen.findByText(/isn.t available here yet/)).toBeInTheDocument();
  });
});

describe('topic links in Help answers', () => {
  beforeEach(() => {
    api.fetchHelpArticles.mockResolvedValue([rx, vitals]);
  });

  it('splits [topic:slug] tokens off the answer', () => {
    expect(
      splitTopicLinks(
        'Click Print label.\n\n[topic:emr-10-prescriptions] [topic:EMR-10-prescriptions]'
      )
    ).toEqual({
      text: 'Click Print label.',
      slugs: ['emr-10-prescriptions'],
    });
  });

  it('shows the answer with an Open link to the topic', async () => {
    render(
      <MemoryRouter>
        <AssistantAnswer content={'Click Print label.\n\n[topic:emr-10-prescriptions]'} />
      </MemoryRouter>
    );
    expect(screen.getByText('Click Print label.')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /Open: Prescriptions: directions/ });
    expect(link).toHaveAttribute('href', '/schedule/help?topic=emr-10-prescriptions');
    expect(screen.queryByText(/\[topic:/)).toBeNull();
  });
});

describe('questions Help could not answer', () => {
  beforeEach(() => {
    api.fetchHelpArticles.mockResolvedValue([rx]);
    api.fetchHelpGaps.mockResolvedValue([
      { id: 'g1', question: 'How do I merge two clients?', createdAt: '2026-11-07T15:00:00Z' },
    ]);
    api.removeHelpGap.mockResolvedValue(undefined);
  });

  it('lists them for admins and removes one with Done', async () => {
    render(
      <MemoryRouter>
        <HelpTopics showGaps />
      </MemoryRouter>
    );
    expect(await screen.findByText(/Questions Help couldn.t answer \(1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Done'));
    expect(api.removeHelpGap).toHaveBeenCalledWith('g1');
    expect(screen.queryByText('How do I merge two clients?')).toBeNull();
  });

  it('is hidden from staff', async () => {
    render(
      <MemoryRouter>
        <HelpTopics />
      </MemoryRouter>
    );
    await screen.findByText('EMR');
    expect(api.fetchHelpGaps).not.toHaveBeenCalled();
    expect(screen.queryByText(/couldn.t answer/)).toBeNull();
  });
});
