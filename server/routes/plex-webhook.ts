import PlexAPI from '@server/api/plexapi';
import { getAdminUser } from '@server/lib/collections/core/CollectionUtilities';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import multer from 'multer';

const router = Router();
const upload = multer();

interface PlexWebhookMetadata {
  ratingKey?: string;
  type?: string;
  title?: string;
  editionTitle?: string;
}

interface PlexWebhookPayload {
  event: string;
  Metadata?: PlexWebhookMetadata;
}

function isPlaceholderMetadata(metadata: PlexWebhookMetadata): boolean {
  // Movie placeholders: editionTitle is set from the {edition-Trailer} filename token
  if (
    metadata.editionTitle &&
    metadata.editionTitle.toLowerCase().includes('trailer')
  ) {
    return true;
  }
  // TV placeholders: PlaceholderTitleFixer sets "Trailer (Placeholder)" after scan.
  // Before it runs, Plex reads the filename S00E00.Trailer.mp4 and titles it "Trailer".
  if (
    metadata.type === 'episode' &&
    (metadata.title === 'Trailer (Placeholder)' || metadata.title === 'Trailer')
  ) {
    return true;
  }
  return false;
}

async function getPlexClient(): Promise<PlexAPI | null> {
  try {
    const adminUser = await getAdminUser();
    if (!adminUser?.plexToken) return null;
    const settings = getSettings();
    return new PlexAPI({
      plexToken: adminUser.plexToken,
      plexSettings: settings.plex,
    });
  } catch {
    return null;
  }
}

async function unscrobblePlaceholder(
  ratingKey: string,
  plexClient: PlexAPI
): Promise<void> {
  try {
    await plexClient.markItemAsUnplayed(ratingKey);
    logger.info('Unscrobbled placeholder item', {
      label: 'PlexWebhook',
      ratingKey,
    });
  } catch (error) {
    logger.error('Failed to unscrobble placeholder item', {
      label: 'PlexWebhook',
      ratingKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// POST / — receives Plex webhook events (multipart/form-data)
router.post('/', upload.single('thumb'), async (req, res) => {
  // Respond immediately — Plex doesn't wait for our processing
  res.sendStatus(200);

  const rawPayload = req.body?.payload as string | undefined;
  if (!rawPayload) {
    logger.warn('Received webhook with no payload', { label: 'PlexWebhook' });
    return;
  }

  let payload: PlexWebhookPayload;
  try {
    payload = JSON.parse(rawPayload) as PlexWebhookPayload;
  } catch {
    logger.warn('Failed to parse webhook payload JSON', {
      label: 'PlexWebhook',
    });
    return;
  }

  const { event, Metadata: metadata } = payload;

  logger.info('Plex webhook received', {
    label: 'PlexWebhook',
    event,
    title: metadata?.title,
    type: metadata?.type,
    editionTitle: metadata?.editionTitle,
    ratingKey: metadata?.ratingKey,
  });

  // Act on play, stop, and scrobble events
  // media.scrobble is fired by Plex when an item is marked as watched (~90% completion)
  if (
    event !== 'media.play' &&
    event !== 'media.stop' &&
    event !== 'media.scrobble'
  )
    return;
  if (!metadata?.ratingKey) return;

  const ratingKey = String(metadata.ratingKey);

  if (!isPlaceholderMetadata(metadata)) return;

  logger.info('Placeholder detected — calling unscrobble', {
    label: 'PlexWebhook',
    event,
    ratingKey,
    title: metadata.title,
    editionTitle: metadata.editionTitle,
  });

  const plexClient = await getPlexClient();
  if (plexClient) {
    await unscrobblePlaceholder(ratingKey, plexClient);
  }
});

export default router;
