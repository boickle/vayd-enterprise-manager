import {
  getIdexxResult,
  idexxResultIsPartial,
  listIdexxResults,
  type IdexxResultDetail,
  type IdexxResultTest,
} from '../../api/idexx';
import { chatAboutChart } from '../../api/soapScribe';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import { stripCitationTokens } from '../../utils/chartCitation';
import { loadPatientHistorySource } from '../../utils/patientHistorySource';
import { idexxTestFlag } from './idexxFlags';

/** Earlier IDEXX results read for trends. */
const MAX_PRIOR_RESULTS = 4;

function resultDate(r: {
  specimenCollectionDate: string | null;
  idexxUpdatedAt: string | null;
  receivedAt: string | null;
}): string {
  const raw = r.specimenCollectionDate ?? r.idexxUpdatedAt ?? r.receivedAt;
  return raw ? raw.slice(0, 10) : 'date unknown';
}

function testKey(t: IdexxResultTest): string {
  return (t.code || t.analyte || t.name || '').trim().toLowerCase();
}

function valueText(t: IdexxResultTest): string {
  return [t.qualifier, t.result ?? '—', t.units].filter(Boolean).join(' ');
}

function flagWord(t: IdexxResultTest): string {
  const flag = idexxTestFlag(t);
  return flag === 'critical'
    ? ' CRITICAL'
    : flag === 'high'
      ? ' HIGH'
      : flag === 'low'
        ? ' LOW'
        : '';
}

function currentResultBlock(r: IdexxResultDetail): string {
  const lines = [
    `IDEXX result to explain (collected ${resultDate(r)}, ${
      (r.status || '').toUpperCase() === 'COMPLETE' && !idexxResultIsPartial(r)
        ? 'final'
        : 'partial — some results are still pending'
    }):`,
  ];
  for (const c of r.categories) {
    lines.push(`${c.name ?? 'Tests'}:`);
    for (const t of c.tests) {
      const ref = t.referenceRange ? ` (reference ${t.referenceRange})` : '';
      lines.push(`- ${t.name}: ${valueText(t)}${ref}${flagWord(t)}`);
      for (const n of t.notes ?? []) lines.push(`  note: ${n}`);
    }
    for (const n of c.notes ?? [])
      lines.push(`  ${[n.title, n.content].filter(Boolean).join(': ')}`);
  }
  if (r.notes?.content) lines.push(`Lab comment: ${r.notes.content}`);
  return lines.join('\n');
}

/** For each test on this result, what it read on the pet's earlier IDEXX results. */
async function priorValuesBlock(current: IdexxResultDetail): Promise<string> {
  if (current.patientId == null) return '';
  const { items } = await listIdexxResults({
    patientId: current.patientId,
    status: 'COMPLETE',
    limit: 25,
  }).catch(() => ({ items: [] }));
  const before = resultDate(current);
  const prior = items
    .filter((r) => r.id !== current.id && resultDate(r) <= before)
    .sort((a, b) => resultDate(b).localeCompare(resultDate(a)))
    .slice(0, MAX_PRIOR_RESULTS);
  if (!prior.length) return 'Earlier IDEXX results: none in Scout.';
  const details = await Promise.all(prior.map((r) => getIdexxResult(r.id).catch(() => null)));

  const wanted = new Map<string, string>();
  for (const c of current.categories) {
    for (const t of c.tests) {
      const key = testKey(t);
      if (key) wanted.set(key, t.name ?? key);
    }
  }
  const history = new Map<string, string[]>();
  for (const d of details) {
    if (!d) continue;
    for (const c of d.categories) {
      for (const t of c.tests) {
        const key = testKey(t);
        if (!wanted.has(key)) continue;
        const list = history.get(key) ?? [];
        list.push(`${resultDate(d)} ${valueText(t)}${flagWord(t)}`);
        history.set(key, list);
      }
    }
  }
  if (!history.size) return 'Earlier IDEXX results: none for these tests.';
  const lines = ['Earlier IDEXX values for the same tests (newest first):'];
  for (const [key, values] of history) lines.push(`- ${wanted.get(key)}: ${values.join('; ')}`);
  return lines.join('\n');
}

/**
 * An AI draft of the owner-facing explanation of one IDEXX result, written against the
 * pet's whole Scout chart and its earlier IDEXX values. The doctor edits and approves it.
 */
export async function draftIdexxClientSummary(
  result: IdexxResultDetail,
  patientName: string
): Promise<string> {
  if (result.patientId == null) throw new Error('Match this result to a pet first.');
  const [history, prior] = await Promise.all([
    loadPatientHistorySource({
      practiceId: Number(VISIT_WORKFLOW_PRACTICE_ID),
      patientId: result.patientId,
      patientName,
      clientName: null,
    }),
    priorValuesBlock(result),
  ]);
  const sourceText = [
    history.text.trim() || '(No other chart history in Scout.)',
    currentResultBlock(result),
    prior,
  ].join('\n\n');

  const answer = await chatAboutChart({
    sourceText,
    patientName,
    clientName: history.owner,
    asOfDate: history.today,
    patientId: result.patientId,
    question: [
      `Write the email the owner will read about ${patientName}'s IDEXX lab results${
        history.owner ? ` (owner ${history.owner}; greet them by first name)` : ''
      }.`,
      'Succinct and warm, like a short note from the doctor who knows this pet. Plain language. Explain a medical term only when you use one.',
      'One or two sentences for the bottom line. Then only the values that are out of range, each as a "- " bullet: high or low, what it looks at, and what that can mean for this pet.',
      'Connect this pet’s history to these results. Use a condition, medication, the reason for this visit, or an earlier value only when it changes what this lab means. Say in a few words whether a repeated value is better, worse, or about the same.',
      'If the chart has nothing that bears on this panel, one short clause is enough. Do not recap unrelated history or older panels.',
      'Normal results: one reassuring sentence, not a list.',
      'Do not diagnose or promise anything the chart does not say. If a value is critical, say calmly that the doctor will be in touch or that they should call the practice.',
      'If the chart states a plan or recheck, end with one line, "Next steps:". Otherwise end with "Next steps: [doctor to add]".',
      'Plain text only: no headings, bold, tables, [ref:…] tokens, record IDs or source markers. Do not sign it.',
      'Under 160 words.',
    ].join(' '),
  });
  const text = stripCitationTokens(answer.trim());
  if (!text) throw new Error('No summary came back.');
  return text;
}
