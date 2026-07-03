// External media search — the Hoard port's metadata sources. OpenLibrary and
// Jikan are keyless; TMDB needs TMDB_API_KEY; games/music are manual-add in v1.

import type { MediaDomain, MediaSearchResult } from '@lodestar/shared';
import { config } from '../config.js';

const TIMEOUT = 15_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Lodestar/0.1 (self-hosted media tracker)' },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

async function searchOpenLibrary(q: string): Promise<MediaSearchResult[]> {
  const data = (await getJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i`,
  )) as { docs?: Array<Record<string, unknown>> };
  return (data.docs ?? []).slice(0, 10).map((d) => ({
    domain: 'book',
    title: str(d.title) ?? 'Untitled',
    creator: Array.isArray(d.author_name) ? str(d.author_name[0]) : null,
    year: num(d.first_publish_year),
    image_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    description: null,
    external_source: 'openlibrary',
    external_id: String(d.key ?? ''),
  }));
}

async function searchJikan(domain: 'anime' | 'manga', q: string): Promise<MediaSearchResult[]> {
  const data = (await getJson(
    `https://api.jikan.moe/v4/${domain}?q=${encodeURIComponent(q)}&limit=10&sfw=true`,
  )) as { data?: Array<Record<string, unknown>> };
  return (data.data ?? []).slice(0, 10).map((d) => {
    const images = d.images as { jpg?: { image_url?: string } } | undefined;
    return {
      domain,
      title: str(d.title) ?? 'Untitled',
      creator: null,
      year:
        num(d.year) ??
        num(
          ((d.aired ?? d.published) as { prop?: { from?: { year?: number } } } | undefined)?.prop
            ?.from?.year,
        ),
      image_url: str(images?.jpg?.image_url),
      description: str(d.synopsis)?.slice(0, 500) ?? null,
      external_source: 'mal',
      external_id: String(d.mal_id ?? ''),
      extra: { score: num(d.score) },
    };
  });
}

async function searchTmdb(domain: 'movie' | 'tv', q: string): Promise<MediaSearchResult[]> {
  if (!config.tmdbApiKey) return [];
  const data = (await getJson(
    `https://api.themoviedb.org/3/search/${domain}?api_key=${config.tmdbApiKey}&query=${encodeURIComponent(q)}`,
  )) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).slice(0, 10).map((d) => ({
    domain,
    title: str(d.title) ?? str(d.name) ?? 'Untitled',
    creator: null,
    year: num(String(str(d.release_date) ?? str(d.first_air_date) ?? '').slice(0, 4)),
    image_url: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
    description: str(d.overview)?.slice(0, 500) ?? null,
    external_source: 'tmdb',
    external_id: String(d.id ?? ''),
    extra: { tmdb_rating: num(d.vote_average) },
  }));
}

/** games/music have no keyless API worth shipping — manual add covers them. */
export async function searchMedia(domain: MediaDomain, q: string): Promise<MediaSearchResult[]> {
  switch (domain) {
    case 'book':
      return searchOpenLibrary(q);
    case 'anime':
    case 'manga':
      return searchJikan(domain, q);
    case 'movie':
    case 'tv':
      return searchTmdb(domain, q);
    case 'game':
    case 'music':
      return [];
  }
}

export function searchAvailable(domain: MediaDomain): boolean {
  if (domain === 'game' || domain === 'music') return false;
  if ((domain === 'movie' || domain === 'tv') && !config.tmdbApiKey) return false;
  return true;
}
