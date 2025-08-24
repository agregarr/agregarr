# Agregarr

Agregarr keeps your Plex Home and Recommended fresh by frequently updating it with Collections from various sources, including Trakt, IMDb, TMdb and Letterboxd, as well as generated Collections from Tautulli Statistics, and Overseerr Requests. It has various options for downloading missing media, including as requests through Overseerr. Collections can be reordered on the Home/Recommended and Library tabs independently, and can have time periods or days set for their visibility in Plex.

## Features

- **Public Lists**: Add public lists from Trakt, IMDb, TMDB and Letterboxd, with presets and custom list options
- **Overseerr Requests**: Generate Colelctions either for each users requests (only visible to that user), or for All Requests
- **Tautulli Statistics**: Generate Collections based on the Most Popular content on your server
- **Automatic Collection Management**: Collections will be be updated on every sync (default 12 hours)
- **Template System**: Easily set collection names with flexible templating
- **Time Restrictions**: Schedule collections to be active only during specific time periods
- **Collection Statistics**: Dashboard showing Most Popular Collections (from Tautulli), and recently added Missing Items
- **Individual Overseerr Requests**: Create collections based on specific user requests, only visible to that user (and the server owner)
- **Library Management**: Organize collections across multiple Plex libraries
- **Exising Collection Integration**: Any pre-existing Collections in Plex and default Hubs (Recently Added etc) can be managed alongside Agregarr Collections

## Installation

### Docker Compose

```yaml
services:
  agregarr:
    image: agregarr/agregarr:develop
    container_name: agregarr
    volumes:
      - /path/to/config:/app/config
    ports:
      - 7171:7171
    restart: unless-stopped
```

The application will be available at `http://localhost:7171`

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Originally built off [Overseerr](https://github.com/sct/Overseerr)
