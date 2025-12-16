/**
 * Poster URL Helper Functions
 *
 * Plex poster URLs can be in multiple formats:
 * - upload://posters/1765149596
 * - /library/metadata/815/thumb/1765149596
 * - http://192.168.0.115:32400/library/metadata/815/thumb/1765149596?X-Plex-Token=xxx
 *
 * These helpers normalize URLs to extract the stable thumb ID for comparison.
 */

/**
 * Extract the stable thumb ID from any Plex poster URL format
 *
 * @param url - Any format of Plex poster URL
 * @returns The thumb ID (e.g., "1765149596") or null if not extractable
 *
 * @example
 * extractThumbId("upload://posters/1765149596") // "1765149596"
 * extractThumbId("/library/metadata/815/thumb/1765149596") // "1765149596"
 * extractThumbId("http://192.168.0.115:32400/library/metadata/815/thumb/1765149596?X-Plex-Token=xxx") // "1765149596"
 */
export function extractThumbId(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  // Format 1: upload://posters/{id}
  if (url.startsWith('upload://posters/')) {
    const id = url.replace('upload://posters/', '');
    return id || null;
  }

  // Format 2: /library/metadata/{ratingKey}/thumb/{id}
  // Format 3: http://.../library/metadata/{ratingKey}/thumb/{id}?X-Plex-Token=xxx
  const thumbMatch = url.match(/\/thumb\/(\d+)/);
  if (thumbMatch && thumbMatch[1]) {
    return thumbMatch[1];
  }

  // Couldn't extract thumb ID
  return null;
}

/**
 * Compare two Plex poster URLs for equality
 * Extracts and compares only the stable thumb ID portion
 *
 * @param url1 - First poster URL (any format)
 * @param url2 - Second poster URL (any format)
 * @returns true if both URLs refer to the same poster, false otherwise
 *
 * @example
 * posterUrlsMatch(
 *   "upload://posters/1765149596",
 *   "http://192.168.0.115:32400/library/metadata/815/thumb/1765149596?X-Plex-Token=xxx"
 * ) // true
 */
export function posterUrlsMatch(
  url1: string | null | undefined,
  url2: string | null | undefined
): boolean {
  const id1 = extractThumbId(url1);
  const id2 = extractThumbId(url2);

  // Both must have valid IDs to match
  if (!id1 || !id2) {
    return false;
  }

  return id1 === id2;
}
