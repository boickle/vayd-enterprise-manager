import { Link } from 'react-router';
import {
  citationChipLabel,
  citationOpensInPlace,
  citationTitle,
  splitCitedText,
  type CaseHistoryCitation,
} from '../../utils/chartCitation';
import { chatFormatBlocks, chatLooksLikeLetter } from '../../utils/briefChatFormat';

type Props = {
  text: string;
  citations: CaseHistoryCitation[];
  className?: string;
  /** Open exam / note / SOAP here. Return true if handled. Cmd/ctrl-click still follows the chart link. */
  onOpenCitation?: (citation: CaseHistoryCitation) => boolean;
};

function CitedInline({
  text,
  citations,
  onOpenCitation,
}: {
  text: string;
  citations: CaseHistoryCitation[];
  onOpenCitation?: (citation: CaseHistoryCitation) => boolean;
}) {
  const parts = splitCitedText(text, citations);
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return <span key={i}>{part.value}</span>;
        if (!part.citation) {
          return (
            <span key={i} className="brief-cite brief-cite--missing">
              source
            </span>
          );
        }
        const citation = part.citation;
        return (
          <Link
            key={i}
            className="brief-cite"
            to={citation.href}
            title={`Open ${citationTitle(citation)}`}
            onClick={(e) => {
              if (!onOpenCitation || !citationOpensInPlace(citation)) return;
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              if (onOpenCitation(citation)) e.preventDefault();
            }}
          >
            {citationChipLabel(citation)}
          </Link>
        );
      })}
    </>
  );
}

export default function BriefChartCitedText({
  text,
  citations,
  className,
  onOpenCitation,
}: Props) {
  const blocks = chatFormatBlocks(text);
  const letter = chatLooksLikeLetter(text);
  const classes = ['brief-prose', letter ? 'brief-prose--letter' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} className="brief-prose__list">
              {block.items.map((item, j) => (
                <li key={j}>
                  <CitedInline text={item} citations={citations} onOpenCitation={onOpenCitation} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="brief-prose__p">
            <CitedInline text={block.text} citations={citations} onOpenCitation={onOpenCitation} />
          </p>
        );
      })}
    </div>
  );
}
