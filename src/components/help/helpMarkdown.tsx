import type { ReactNode } from 'react';

/**
 * Renders the small markdown subset Help articles use: `## headings`, numbered and bulleted
 * lists (indented bullets nest under the item above), paragraphs, **bold** and `code`.
 * Builds React elements only, so article text can never inject HTML.
 */
export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    out.push(
      token.startsWith('**') ? (
        <strong key={`${keyPrefix}-${n++}`}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={`${keyPrefix}-${n++}`}>{token.slice(1, -1)}</code>
      )
    );
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type ListItem = { text: string; children: string[] };
type Block =
  | { kind: 'h'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ol' | 'ul'; items: ListItem[] };

export function parseHelpMarkdown(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const nested = /^\s{2,}[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    const lastBlock = blocks[blocks.length - 1];
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: 'h', text: heading[1] });
    } else if (
      nested &&
      lastBlock &&
      (lastBlock.kind === 'ol' || lastBlock.kind === 'ul') &&
      !para.length
    ) {
      lastBlock.items[lastBlock.items.length - 1].children.push(nested[1]);
    } else if (ordered || bullet) {
      flush();
      const kind = ordered ? 'ol' : 'ul';
      const text = (ordered ?? bullet)![1];
      if (lastBlock && lastBlock.kind === kind) lastBlock.items.push({ text, children: [] });
      else blocks.push({ kind, items: [{ text, children: [] }] });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export function HelpMarkdown({ body }: { body: string }) {
  return (
    <div className="help-md">
      {parseHelpMarkdown(body).map((block, i) => {
        if (block.kind === 'h') return <h4 key={i}>{renderInline(block.text, `h${i}`)}</h4>;
        if (block.kind === 'p') return <p key={i}>{renderInline(block.text, `p${i}`)}</p>;
        const List = block.kind;
        return (
          <List key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                {renderInline(item.text, `l${i}-${j}`)}
                {item.children.length ? (
                  <ul>
                    {item.children.map((child, k) => (
                      <li key={k}>{renderInline(child, `c${i}-${j}-${k}`)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
