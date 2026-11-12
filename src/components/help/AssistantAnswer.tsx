import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen } from 'lucide-react';
import { fetchHelpArticles, splitTopicLinks } from '../../api/scoutHelp';

/**
 * A Help assistant answer: the text, then a link to each help topic it used
 * ([topic:slug] tokens from the API become "Open: <topic title>").
 */
export default function AssistantAnswer({ content }: { content: string }) {
  const { text, slugs } = splitTopicLinks(content);
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slugs.length) return;
    let canceled = false;
    fetchHelpArticles()
      .then((articles) => {
        if (canceled) return;
        setTitles(Object.fromEntries(articles.map((a) => [a.slug, a.title])));
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [slugs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
      {slugs.length ? (
        <p className="help-answer__links">
          {slugs.map((slug) => (
            <Link
              key={slug}
              to={`/schedule/help?topic=${encodeURIComponent(slug)}`}
              className="help-answer__link"
            >
              <BookOpen size={13} aria-hidden /> Open: {titles[slug] ?? 'help topic'}
            </Link>
          ))}
        </p>
      ) : null}
    </>
  );
}
