# Agregarr

Agregarr keeps your Plex Home and Recommended fresh by frequently updating it with Collections from various sources, including Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol (Networks Top 10), AniList and MyAnimeList, as well as generated Collections from Tautulli Statistics, and Overseerr Requests. It has various options for downloading missing media, including as requests through Overseerr, or directly through Radarr/Sonarr. Collections can be reordered on the Home/Recommended and Library tabs independently, and can have time periods or days set for their visibility in Plex.

## Features

- **Public Lists**: Add public lists from Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol (Networks Top 10), AniList and MyAnimeList, with presets and custom list options.
- **Grab Missing Items**: Missing items from lists can be added via Radarr/Sonarr or Overseerr, with various filters available including release year, season count, list position, genre, and origin country
- **Coming Soon**: Create Coming Soon Collections based off monitored content in Radarr/Sonarr, or anticipated releases from Trakt, complete with trailers and poster overlays.
- **Overseerr Requests**: Generate Collections either for each users requests (only visible to that user), or for All Requests
- **Tautulli Statistics**: Generate Collections based on the Most Popular content on your server
- **Independent Reordering**: Control the order in which Collections appear across the Home/Recommended screens and the Library tab independently
- **Keeps Plex Updated**: Collections will be be updated on every sync (default 12 hours, custom scheduling available). Custom sync options available per-collection.
- **Randomise Home Order**: Keep your home screen dynamic by rotating the order in which collections appear (separate scheduling available)
- **Template System**: Easily set collection names with flexible templating and title importing from lists.
- **Time Restrictions**: Schedule collections to be active only during specific time periods
- **Existing Collection Integration**: Any pre-existing Collections in Plex and Default Hubs (Recently Added etc) can be managed alongside Agregarr Collections
- **Collection Statistics**: Dashboard showing Most Popular Collections (from Tautulli), and recently added Missing Items
- **Poster Templates**: Create your own Poster Templates which can be dynamically filled with content per-collection
- **Preview Collections**: Preview the collection and its matching/missing items, and add them individually via Radarr/Sonarr or Overseerr, or add items to the global exclusions list.

<img width="1902" height="983" alt="agregarr-promo" src="https://github.com/user-attachments/assets/1b744502-30ce-4988-93fc-4588e1207e69" />

## Installation

### Docker Compose

```yaml
services:
  agregarr:
    image: agregarr/agregarr:latest
    container_name: agregarr
    volumes:
      - /path/to/config:/app/config # Change /path/to/config to your actual config path
      # Linux/Mac: - /mnt/serverdata/configs/agregarr:/app/config
      # Windows:   - C:\serverdata\configs\agregarr:/app/config

      # Optional: For Coming Soon/Placeholder feature
      - /path/to/placeholder/movies:/data/movies
      - /path/to/placeholder/tv:/data/tv
      # Linux/Mac:
      # - /mnt/media/movie-placeholders:/data/movies
      # - /mnt/media/tv-placeholders:/data/tv
      # Windows:
      # - E:\media\movie-placeholders:/data/movies
      # - E:\media\tv-placeholders:/data/tv

      # And then select your root folders in Settings -> Downloads
    environment:
      - TZ=Pacific/Auckland # Set to your local timezone for accurate poster overlay release dates/countdowns - see 'TZ Identifier' column here https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
    ports:
      - 7171:7171
    restart: unless-stopped
```

Further instructions for basic setup available [**here**](https://agregarr.org/docs/installation) and Placeholder media volumes [**here**](https://agregarr.org/docs/placeholder-volumes)

The application will be available at `http://localhost:7171`

> **Note**: Your volume must be set correctly for the your settings to persist. If Agregarr is reset after restart, it is because your volume is not set correctly. The Coming Soon/Placeholder feature requires media volumes to be mounted, these folders should be added to Plex, but not added to Radarr/Sonarr. Without media mounts, Agregarr can run remotely and all other features will work normally.

## License

GPL-3.0 License - see [LICENSE](LICENSE) file for details.

## Credits

Originally built off [**Overseerr**](https://github.com/sct/Overseerr)

Inspired by [Kometa](https://github.com/Kometa-Team/Kometa)

Code references for Coming Soon feature from [UMTK](https://github.com/netplexflix/Upcoming-Movies-TV-Shows-for-Kometa)

Anime ID mappings file by [PlexAniBridge](https://github.com/eliasbenb/PlexAniBridge)

A massive thanks to the developers and contributors of these projects!
