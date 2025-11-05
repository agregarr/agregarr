# Agregarr

Agregarr keeps your Plex Home and Recommended fresh by frequently updating it with Collections from various sources, including Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol (Networks Top 10), AniList and MyAnimeList, as well as generated Collections from Tautulli Statistics, and Overseerr Requests. It has various options for downloading missing media, including as requests through Overseerr, or directly through Radarr/Sonarr. Collections can be reordered on the Home/Recommended and Library tabs independently, and can have time periods or days set for their visibility in Plex.

## Features

- **Public Lists**: Add public lists from Trakt, IMDb, TMDB, Letterboxd, MDBList, FlixPatrol (Networks Top 10), AniList and MyAnimeList, with presets and custom list options.
- **Grab Missing Items**: Missing items from lists can be added via Radarr/Sonarr or Overseerr, with various filters available including release year, season count, list position, genre, and origin country
- **Coming Soon**: Create Coming Soon Collections based off monitored content in Radarr/Sonarr, or anticipated releases from Trakt, complete with trailers and poster overlays.
- **Overseerr Requests**: Generate Collections either for each users requests (only visible to that user), or for All Requests
- **Tautulli Statistics**: Generate Collections based on the Most Popular content on your server
- **Independent Reordering**: Control the order in which Collections appear across the Home/Recommended screens and the Library tab independetly
- **Keeps Plex Updated**: Collections will be be updated on every sync (default 12 hours, custom scheduling available). Custom sync options available per-collection.
- **Randomise Home Order**: Keep your home screen dynamic by rotating the order in which collections appear (seperate scheduling available)
- **Template System**: Easily set collection names with flexible templating and title importing from lists.
- **Time Restrictions**: Schedule collections to be active only during specific time periods
- **Exising Collection Integration**: Any pre-existing Collections in Plex and Default Hubs (Recently Added etc) can be managed alongside Agregarr Collections
- **Collection Statistics**: Dashboard showing Most Popular Collections (from Tautulli), and recently added Missing Items
- **Poster Templates**: Create your own Poster Templates which can be dynamically filled with content per-collection
- **Preview Collections**: Preview the collection and its matching/missing items, and add them individually via Radarr/Sonarr or Overseerr, or add items to the global exclusions list.

<img width="1920" height="935" alt="vlcsnap-2025-08-25-21h02m59s912" src="https://github.com/user-attachments/assets/3ff916d1-2172-4f58-9581-362febbfa0eb" />

## Installation

### Docker Compose

```yaml
services:
  agregarr:
    image: agregarr/agregarr:latest
    container_name: agregarr
    volumes:
      - /path/to/config:/app/config
      # Optional: For Coming Soon feature, mount media matching Radarr/Sonarr paths
      # Linux/Mac: - /mnt/media/movies:/data/movies
      #            - /mnt/media/tv:/data/tv
      # Windows:   - E:\media\movies:/mnt/e/media/movies
      #            - E:\media\tv:/mnt/e/media/tv
    ports:
      - 7171:7171
    restart: unless-stopped
```

The application will be available at `http://localhost:7171`

> **Note**: The Coming Soon feature requires media volumes to be mounted with paths matching your Radarr/Sonarr containers. Without media mounts, Agregarr can run remotely and all other features will work normally.

## License

GPL-3.0 License - see [LICENSE](LICENSE) file for details.

## Credits

Originally built off [Overseerr](https://github.com/sct/Overseerr)

## Credits

Originally built off [Overseerr](https://github.com/sct/Overseerr)

Agregarr draws inspiration and code references from these excellent open-source projects:

- [**Kometa**](https://github.com/Kometa-Team/Kometa) - General inspiration
- [**UMTK**](https://github.com/netplexflix/Upcoming-Movies-TV-Shows-for-Kometa) - Coming Soon collection feature
- [**PlexAniBridge**](https://github.com/PlexAniBridge/PlexAniBridge) - Anime ID mappings file

A huge thanks to the developers and contributors of these projects!
