import { getRankedAnime, type MALRankingType } from '@server/api/myanimelist';
import { getSettings } from '@server/lib/settings';
import { Router } from 'express';

const router = Router();

/**
 * Test ranked endpoint with detailed logging
 */
router.get('/test-ranked', async (req, res) => {
  try {
    const settings = getSettings();
    const apiKey = settings.myanimelist?.apiKey;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'MyAnimeList API key not configured',
      });
    }

    const data = await getRankedAnime('all', 10);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * Fetch MyAnimeList data
 */
router.get('/list', async (req, res) => {
  const { type } = req.query;

  try {
    const settings = getSettings();
    const apiKey = settings.myanimelist?.apiKey;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'MyAnimeList API key not configured',
      });
    }

    // Use the appropriate ranking type from myanimelist.ts based on the type
    const rankingType = String(type || 'all') as MALRankingType;

    // Validate ranking type
    const validTypes: MALRankingType[] = [
      'all',
      'airing',
      'tv',
      'ova',
      'movie',
      'special',
      'bypopularity',
      'favorite',
    ];
    if (!validTypes.includes(rankingType)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ranking type' });
    }

    const data = await getRankedAnime(rankingType, 50);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
