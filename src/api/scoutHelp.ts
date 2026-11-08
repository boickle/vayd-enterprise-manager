import { http } from './http';

/** One Help topic. The same markdown the Help assistant answers from (vayd-api src/scribe/help). */
export type HelpArticle = {
  slug: string;
  title: string;
  module: string;
  order: number;
  /** Who does this task, e.g. ["Doctors", "Techs"]. Empty means everyone. */
  roles: string[];
  reviewed: string | null;
  keywords: string[];
  /** Markdown: ## headings, numbered and bulleted lists, **bold**. */
  body: string;
  hasVideo: boolean;
  videoNote: string | null;
};

let articlesPromise: Promise<HelpArticle[]> | null = null;

/** Loaded once per page load (topics only change with a deploy); a failure is retried next call. */
export function fetchHelpArticles(): Promise<HelpArticle[]> {
  if (!articlesPromise) {
    articlesPromise = http
      .get<{ articles?: HelpArticle[] }>('/scribe/help/articles')
      .then(({ data }) => data.articles ?? [])
      .catch((err) => {
        articlesPromise = null;
        throw err;
      });
  }
  return articlesPromise;
}

/** Test hook. */
export function resetHelpArticlesCache(): void {
  articlesPromise = null;
}

export type HelpQuestionGap = { id: string; question: string; createdAt: string };

/** Admins: how-to questions Help couldn't answer (saved without names). */
export async function fetchHelpGaps(): Promise<HelpQuestionGap[]> {
  const { data } = await http.get<{ gaps?: HelpQuestionGap[] }>('/scribe/help/gaps');
  return data.gaps ?? [];
}

export async function removeHelpGap(id: string): Promise<void> {
  await http.delete(`/scribe/help/gaps/${encodeURIComponent(id)}`);
}

const TOPIC_TOKEN = /\[topic:([a-z0-9-]+)\]/gi;

/** Split an assistant answer into its text and the help topics it linked with [topic:slug]. */
export function splitTopicLinks(answer: string): { text: string; slugs: string[] } {
  const slugs: string[] = [];
  const text = answer
    .replace(TOPIC_TOKEN, (_m, slug: string) => {
      const s = slug.toLowerCase();
      if (!slugs.includes(s)) slugs.push(s);
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return { text, slugs };
}

/** Short-lived private link to the topic's training video. */
export async function fetchHelpVideoUrl(slug: string): Promise<string> {
  const { data } = await http.get<{ url: string }>(
    `/scribe/help/articles/${encodeURIComponent(slug)}/video`
  );
  return data.url;
}
