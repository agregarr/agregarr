import NodeCache from 'node-cache';

export type AvailableCacheIds =
  | 'tmdb'
  | 'radarr'
  | 'sonarr'
  | 'rt'
  | 'imdb'
  | 'flixpatrol'
  | 'github'
  | 'plexguid'
  | 'plextv'
  | 'plexwatchlist'
  | 'trakt-list'
  | 'imdb-list'
  | 'letterboxd-list'
  | 'tmdb-list'
  | 'mdblist-list'
  | 'tautulli-list'
  | 'overseerr-list'
  | 'networks-list'
  | 'originals-list'
  | 'anilist-list'
  | 'myanimelist-list';

const DEFAULT_TTL = 300;
const DEFAULT_CHECK_PERIOD = 120;

class Cache {
  public id: AvailableCacheIds;
  public data: NodeCache;
  public name: string;

  constructor(
    id: AvailableCacheIds,
    name: string,
    options: { stdTtl?: number; checkPeriod?: number } = {}
  ) {
    this.id = id;
    this.name = name;
    this.data = new NodeCache({
      stdTTL: options.stdTtl ?? DEFAULT_TTL,
      checkperiod: options.checkPeriod ?? DEFAULT_CHECK_PERIOD,
    });
  }

  public getStats() {
    return this.data.getStats();
  }

  public flush(): void {
    this.data.flushAll();
  }
}

class CacheManager {
  private availableCaches: Record<AvailableCacheIds, Cache> = {
    tmdb: new Cache('tmdb', 'The Movie Database API', {
      stdTtl: 21600,
      checkPeriod: 60 * 30,
    }),
    radarr: new Cache('radarr', 'Radarr API'),
    sonarr: new Cache('sonarr', 'Sonarr API'),
    rt: new Cache('rt', 'Rotten Tomatoes API', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    imdb: new Cache('imdb', 'IMDB Radarr Proxy', {
      stdTtl: 43200,
      checkPeriod: 60 * 30,
    }),
    flixpatrol: new Cache('flixpatrol', 'FlixPatrol API', {
      stdTtl: 3600, // 1 hour cache for streaming top 10 data
      checkPeriod: 60 * 15,
    }),
    github: new Cache('github', 'GitHub API', {
      stdTtl: 21600,
      checkPeriod: 60 * 30,
    }),
    plexguid: new Cache('plexguid', 'Plex GUID', {
      stdTtl: 86400 * 7, // 1 week cache
      checkPeriod: 60 * 30,
    }),
    plextv: new Cache('plextv', 'Plex TV', {
      stdTtl: 86400 * 7, // 1 week cache
      checkPeriod: 60,
    }),
    plexwatchlist: new Cache('plexwatchlist', 'Plex Watchlist'),
    // List caches - cache external list data between syncs for faster preview
    // 7-day TTL as safety net (syncs normally refresh cache long before expiration)
    'trakt-list': new Cache('trakt-list', 'Trakt Lists', {
      stdTtl: 86400 * 7, // 7 day cache - safety net if syncs stop
      checkPeriod: 60 * 60,
    }),
    'imdb-list': new Cache('imdb-list', 'IMDb Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'letterboxd-list': new Cache('letterboxd-list', 'Letterboxd Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'tmdb-list': new Cache('tmdb-list', 'TMDb Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'mdblist-list': new Cache('mdblist-list', 'MDBList Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'tautulli-list': new Cache('tautulli-list', 'Tautulli Stats', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'overseerr-list': new Cache('overseerr-list', 'Overseerr Requests', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'networks-list': new Cache('networks-list', 'Network Top 10', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'originals-list': new Cache('originals-list', 'Provider Originals', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'anilist-list': new Cache('anilist-list', 'AniList Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
    'myanimelist-list': new Cache('myanimelist-list', 'MyAnimeList Lists', {
      stdTtl: 86400 * 7, // 7 day cache
      checkPeriod: 60 * 60,
    }),
  };

  public getCache(id: AvailableCacheIds): Cache {
    return this.availableCaches[id];
  }

  public getAllCaches(): Record<string, Cache> {
    return this.availableCaches;
  }
}

const cacheManager = new CacheManager();

export default cacheManager;
