# Agregarr

Agregarr keeps your Plex Home and Recommended sections fresh by automatically syncing collections from sources such as Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol, AniList, MyAnimeList, Tautulli statistics, and Overseerr requests.

Use it to build dynamic Plex collections, request missing media through Overseerr, Radarr, or Sonarr, and control where and when collections appear across Plex Home, Recommended, and Library views.

## Features

- **Public lists**: Add public lists from Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol, AniList, and MyAnimeList, with presets and custom list options.
- **Missing media requests**: Add missing items via Radarr, Sonarr, or Overseerr, with filters for release year, season count, list position, genre, origin country, and more.
- **Coming Soon collections**: Build collections from monitored Radarr/Sonarr content or anticipated Trakt releases, including trailers and poster overlays.
- **Overseerr request collections**: Generate per-user request collections or a combined All Requests collection.
- **Tautulli statistics**: Create collections from the most popular content on your Plex server.
- **Independent reordering**: Control collection order independently for Home, Recommended, and Library views.
- **Automatic Plex updates**: Keep collections updated on every sync, with global and per-collection scheduling options.
- **Randomized Home order**: Rotate collection order on Plex Home with a separate schedule.
- **Template system**: Build collection names with flexible templates and imported list titles.
- **Time restrictions**: Show collections only during specific days or date ranges.
- **Existing collection support**: Manage pre-existing Plex collections and default hubs, such as Recently Added, alongside Agregarr collections.
- **Collection statistics**: Review dashboard stats for popular collections and recently added missing items.
- **Poster templates**: Create reusable poster templates that can be filled dynamically per collection.
- **Collection previews**: Preview matching and missing items before syncing, request items individually, or add them to global exclusions.

<img width="1902" height="983" alt="agregarr-promo" src="https://github.com/user-attachments/assets/1b744502-30ce-4988-93fc-4588e1207e69" />

## Installation

### Docker Compose

Create a `docker-compose.yml` file and update the volume paths for your environment:

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
      - TZ=Pacific/Auckland # Set to your local timezone for accurate poster overlay release dates/countdowns.
    ports:
      - 7171:7171
    restart: unless-stopped
```

Use a valid TZ database name, such as `Europe/Berlin`, `America/New_York`, or `Pacific/Auckland`.

Further instructions are available in the [installation guide](https://agregarr.org/docs/installation) and [placeholder volume guide](https://agregarr.org/docs/placeholder-volumes).

The application will be available at `http://localhost:7171`

> **Note**: The `/app/config` volume must be configured correctly for your settings to persist. If Agregarr resets after a restart, check this volume first. Coming Soon and placeholder media features require media volumes to be mounted. These folders should be added to Plex, but not to Radarr or Sonarr. Without media mounts, Agregarr can still run remotely and all other features will work normally.

## License

GPL-3.0 License - see [LICENSE](LICENSE) file for details.

## Credits

Originally built from [Overseerr](https://github.com/sct/Overseerr).

Inspired by [Kometa](https://github.com/Kometa-Team/Kometa).

Code references for the Coming Soon feature from [UMTK](https://github.com/netplexflix/Upcoming-Movies-TV-Shows-for-Kometa).

Anime ID mappings file by [PlexAniBridge](https://github.com/eliasbenb/PlexAniBridge).

A massive thanks to the developers and contributors of these projects!
