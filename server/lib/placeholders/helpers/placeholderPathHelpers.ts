import { getSettings } from '@server/lib/settings';

/**
 * Get placeholder root folder for a specific library
 * Returns the library-specific placeholder folder path or undefined if not configured
 *
 * @param libraryKey - Plex library key
 * @param mediaType - Media type ('movie' or 'tv')
 * @returns Placeholder root folder path or undefined
 */
export function getPlaceholderRootFolder(
  libraryKey: string,
  mediaType: 'movie' | 'tv'
): string | undefined {
  const settings = getSettings();

  // Get library-specific folder based on media type
  const folders =
    mediaType === 'movie'
      ? settings.main.placeholderMovieRootFolders
      : settings.main.placeholderTVRootFolders;

  return folders?.[libraryKey];
}
