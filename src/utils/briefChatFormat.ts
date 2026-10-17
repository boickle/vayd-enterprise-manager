export type ChatFormatBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] };

const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+(.+)$/;

function looksLikeLetter(text: string): boolean {
  return (
    /^\s*(dear|hello|hi)\s+/i.test(text) &&
    /(sincerely|warmly|best regards|thank you|vet at your door|, veterinarian|, veterinary)/i.test(
      text
    )
  );
}

/** Turn jammed "Item: - A - B" and letter blobs into line-broken text. */
export function prettifyChatText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return text;

  if (looksLikeLetter(text) && !text.includes('\n\n')) {
    text = text.replace(/^(dear\s+[^,\n]+,)\s+/i, '$1\n\n');
    text = text.replace(
      /\s+((?:sincerely|warmly|best regards|best|thank you),?)\s+/i,
      '\n\n$1\n'
    );
    text = text.replace(/\s+(\d{3}[-.)\s]\d{3}[-.\s]\d{4})\s*/g, '\n$1\n');
    text = text.replace(/\s+([\w.+-]+@[\w.-]+\.[a-z]{2,})\s*/gi, '\n$1\n');
  }

  const inlineBullets = text.match(/\s+-\s+(?=[A-Z][a-z]{2,})/g);
  if (inlineBullets && inlineBullets.length >= 1 && !/^\s*[-*•]\s/m.test(text)) {
    text = text.replace(/:\s+-\s+/g, ':\n- ');
    text = text.replace(/\s+-\s+(?=[A-Z][a-z]{2,})/g, '\n- ');
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function chatFormatBlocks(raw: string): ChatFormatBlock[] {
  const lines = prettifyChatText(raw).split('\n');
  const blocks: ChatFormatBlock[] = [];
  let items: string[] | null = null;
  let para: string[] | null = null;

  const flushList = () => {
    if (items?.length) blocks.push({ type: 'ul', items });
    items = null;
  };
  const flushPara = () => {
    if (para?.length) blocks.push({ type: 'p', text: para.join(' ').trim() });
    para = null;
  };

  for (const line of lines) {
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushPara();
      items = items ?? [];
      items.push(bullet[1].trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para = para ?? [];
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export function chatLooksLikeLetter(text: string): boolean {
  return looksLikeLetter(text);
}
