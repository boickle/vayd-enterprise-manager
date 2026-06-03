import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { forwardBookingLinkLabel } from '../../utils/forwardBookingCreateLink';

const INTERNAL_PATH_RE = /(\/schedule\/[^\s]+)/g;

function renderLine(line: string, lineKey: number) {
  const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
  let lastIndex = 0;
  for (const match of line.matchAll(INTERNAL_PATH_RE)) {
    const path = match[1];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: line.slice(lastIndex, index) });
    }
    parts.push({ type: 'link', value: path });
    lastIndex = index + path.length;
  }
  if (parts.length === 0) return line;
  if (lastIndex < line.length) {
    parts.push({ type: 'text', value: line.slice(lastIndex) });
  }
  return parts.map((part, i) =>
    part.type === 'link' ? (
      <Link key={`${lineKey}-${i}`} className="pims-task-body__link" to={part.value}>
        {forwardBookingLinkLabel(part.value)}
      </Link>
    ) : (
      <Fragment key={`${lineKey}-${i}`}>{part.value}</Fragment>
    )
  );
}

export function TaskBodyContent({ body }: { body: string | null | undefined }) {
  const text = body?.trim();
  if (!text) return <>—</>;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {renderLine(line, i)}
        </Fragment>
      ))}
    </>
  );
}
