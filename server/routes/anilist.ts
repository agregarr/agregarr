import { Router } from 'express';
import {
  getTrendingAnime,
  getPopularAnime,
} from '@server/api/anilist';

const router = Router();

/**
 * Test trending endpoint with detailed logging
 */
router.get('/test-trending', async (req, res) => {
  try {
    const data = await getTrendingAnime(1, 10, false, {});
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ 
      success: false, 
      message: error.message, 
      stack: error.stack 
    });
  }
});

/**
 * Fetch AniList data
 */
router.get('/list', async (req, res) => {
  const { type, query } = req.query;

  try {
    // Use the appropriate function from anilist.ts based on the type
    let data;
    const t = String(type || '');
    if (t === 'trending') {
      data = await getTrendingAnime();
    } else if (t === 'popular') {
      data = await getPopularAnime();
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
