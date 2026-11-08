import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, BookOpen, PlayCircle, Search } from 'lucide-react';
import {
  fetchHelpArticles,
  fetchHelpGaps,
  fetchHelpVideoUrl,
  removeHelpGap,
  type HelpArticle,
  type HelpQuestionGap,
} from '../../api/scoutHelp';
import { HelpMarkdown } from './helpMarkdown';
import './HelpTopics.css';

/** Every word must appear somewhere in the topic (title, keywords, roles or text). */
export function filterHelpArticles(articles: HelpArticle[], query: string): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  return articles.filter((a) => {
    const haystack = [a.title, a.module, a.keywords.join(' '), a.roles.join(' '), a.body]
      .join(' ')
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function groupByModule(articles: HelpArticle[]): Array<[string, HelpArticle[]]> {
  const groups = new Map<string, HelpArticle[]>();
  for (const a of articles) {
    const list = groups.get(a.module) ?? [];
    list.push(a);
    groups.set(a.module, list);
  }
  return [...groups.entries()];
}

function HelpVideo({ slug }: { slug: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    setUrl(null);
    setFailed(false);
    fetchHelpVideoUrl(slug)
      .then((next) => {
        if (!canceled) setUrl(next);
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
    };
  }, [slug]);

  if (failed) {
    return (
      <p className="help-topics__video-missing">
        The video for this topic isn&apos;t available here yet. The steps below cover the same
        thing.
      </p>
    );
  }
  if (!url)
    return <div className="help-topics__video help-topics__video--loading">Loading video…</div>;
  return (
    // Captions are burned into the Cypress-made training videos; there are no separate caption
    // (.vtt) files yet. The Looms have none.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      className="help-topics__video"
      src={url}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}

/** Admins: how-to questions Help couldn't answer, so they know which topics to write next. */
function HelpGaps() {
  const [gaps, setGaps] = useState<HelpQuestionGap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetchHelpGaps()
      .then((rows) => {
        if (!canceled) setGaps(rows);
      })
      .catch(() => {
        if (!canceled) setError('Could not load the list.');
      });
    return () => {
      canceled = true;
    };
  }, []);

  const remove = (id: string) => {
    setGaps((prev) => prev?.filter((g) => g.id !== id) ?? null);
    void removeHelpGap(id).catch(() =>
      setError('Could not remove that question. Reload and try again.')
    );
  };

  if (!gaps && !error) return null;
  return (
    <details className="help-gaps">
      <summary>Questions Help couldn&apos;t answer ({gaps?.length ?? 0}) · admins only</summary>
      {error ? <p className="pims-detail__banner-error">{error}</p> : null}
      {gaps && !gaps.length ? (
        <p className="pims-emr-case-prep__chat-hint">None yet.</p>
      ) : (
        <ul>
          {gaps?.map((g) => (
            <li key={g.id}>
              <span>{g.question}</span>
              <time dateTime={g.createdAt}>
                {new Date(g.createdAt).toLocaleDateString('en-US')}
              </time>
              <button type="button" className="brief-text-btn" onClick={() => remove(g.id)}>
                Done
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function TopicDetail({ article, onBack }: { article: HelpArticle; onBack: () => void }) {
  return (
    <article className="help-topics__detail" aria-labelledby="help-topic-title">
      <button type="button" className="brief-text-btn help-topics__back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden /> All topics
      </button>
      <p className="help-topics__crumb">{article.module}</p>
      <h3 id="help-topic-title">{article.title}</h3>
      {article.roles.length ? (
        <p className="help-topics__roles">For: {article.roles.join(', ')}</p>
      ) : null}
      {article.hasVideo ? <HelpVideo slug={article.slug} /> : null}
      {article.videoNote ? <p className="help-topics__video-note">{article.videoNote}</p> : null}
      <HelpMarkdown body={article.body} />
      {article.reviewed ? (
        <p className="help-topics__reviewed">Last checked against Scout: {article.reviewed}</p>
      ) : null}
    </article>
  );
}

/** Help page topics: search, list by area, and one open topic (deep link: ?topic=<slug>). */
export default function HelpTopics({ showGaps = false }: { showGaps?: boolean }) {
  const [articles, setArticles] = useState<HelpArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const openSlug = params.get('topic');
  const sectionRef = useRef<HTMLElement>(null);

  // A topic link in an answer (further down the page) opens the topic up here: bring it into view.
  useEffect(() => {
    if (openSlug) sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [openSlug]);

  useEffect(() => {
    let canceled = false;
    fetchHelpArticles()
      .then((next) => {
        if (!canceled) setArticles(next);
      })
      .catch(() => {
        if (!canceled) setError('Could not load help topics. Ask your question below instead.');
      });
    return () => {
      canceled = true;
    };
  }, []);

  const visible = useMemo(() => filterHelpArticles(articles ?? [], query), [articles, query]);
  const open = articles?.find((a) => a.slug === openSlug) ?? null;

  const setOpen = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('topic', slug);
    else next.delete('topic');
    setParams(next);
  };

  return (
    <section
      ref={sectionRef}
      className="pims-emr-prep__card help-topics"
      aria-labelledby="help-topics-head"
    >
      {open ? (
        <TopicDetail article={open} onBack={() => setOpen(null)} />
      ) : (
        <>
          <h3 id="help-topics-head">
            <BookOpen size={15} aria-hidden /> How-to topics
          </h3>
          <label className="help-topics__search">
            <Search size={14} aria-hidden />
            <input
              className="input"
              type="search"
              value={query}
              placeholder="Search topics, e.g. rabies tag, print label, refund"
              aria-label="Search help topics"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {error ? <p className="pims-detail__banner-error">{error}</p> : null}
          {!articles && !error ? (
            <p className="pims-emr-case-prep__chat-hint">Loading topics…</p>
          ) : null}
          {articles && !visible.length ? (
            <p className="pims-emr-case-prep__chat-hint">
              No topic matches &ldquo;{query}&rdquo;. Try fewer words, or ask below.
            </p>
          ) : null}
          {groupByModule(visible).map(([module, list]) => (
            <div key={module} className="help-topics__module">
              <h4>{module}</h4>
              <ul>
                {list.map((a) => (
                  <li key={a.slug}>
                    <button
                      type="button"
                      className="help-topics__topic"
                      onClick={() => setOpen(a.slug)}
                    >
                      <span>{a.title}</span>
                      {a.roles.length ? (
                        <span className="help-topics__chip">{a.roles.join(', ')}</span>
                      ) : null}
                      {a.hasVideo ? <PlayCircle size={14} aria-label="Has a video" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {showGaps ? <HelpGaps /> : null}
        </>
      )}
    </section>
  );
}
