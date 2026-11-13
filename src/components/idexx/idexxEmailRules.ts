import { idexxResultIsPartial } from '../../api/idexx';

type Rules = {
  status: string | null;
  statusDetail: string | null;
  hasPending?: boolean;
  categories?: Array<{ tests?: Array<{ result?: string | null }> }>;
  clientSummary: string | null;
  clientSummaryApprovedAt: string | null;
  clientSummaryStale: boolean;
  reviewedAt: string | null;
};

export type IdexxEmailState = { allowed: boolean; why: string | null };

/**
 * LAB-03 (owner decision D2): "Email lab summary & report" (with the AI summary) only when the summary is
 * approved, IDEXX has not changed the result since, and the result is complete. "Email lab report"
 * (PDF only) only after the result is marked reviewed. No override. `why` is the one line shown.
 */
export function idexxEmailRules(r: Rules): {
  withSummary: IdexxEmailState;
  reportOnly: IdexxEmailState;
} {
  const complete = (r.status || '').toUpperCase() === 'COMPLETE' && !idexxResultIsPartial(r);
  let summaryWhy: string | null = null;
  if (!complete) summaryWhy = "The results aren't complete yet";
  else if (!(r.clientSummary ?? '').trim()) summaryWhy = 'Write and approve a client summary first';
  else if (!r.clientSummaryApprovedAt) summaryWhy = 'The summary needs approving first';
  else if (r.clientSummaryStale)
    summaryWhy =
      'IDEXX changed this result after the summary was approved. Draft it again and approve it';
  const reportWhy = r.reviewedAt ? null : 'Mark the result reviewed first';
  return {
    withSummary: { allowed: summaryWhy == null, why: summaryWhy },
    reportOnly: { allowed: reportWhy == null, why: reportWhy },
  };
}
