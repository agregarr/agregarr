import { getRepository } from '@server/datasource';
import { MissingItemRequest } from '@server/entity/MissingItemRequest';
import logger from '@server/logger';
import { Router } from 'express';

const missingItemsRoutes = Router();

/**
 * @api {get} /api/v1/missing-items Get missing item requests
 * @apiName GetMissingItemRequests
 * @apiGroup MissingItems
 * @apiDescription Retrieve recent missing item requests with optional filtering
 *
 * @apiParam {Number} [limit=10] Number of items to return
 * @apiParam {Number} [offset=0] Number of items to skip
 * @apiParam {String} [status] Filter by request status (pending, approved, declined, available)
 * @apiParam {String} [mediaType] Filter by media type (movie, tv)
 * @apiParam {String} [collectionSource] Filter by collection source (trakt, tmdb, imdb, letterboxd)
 * @apiParam {String} [requestService] Filter by request service (overseerr, radarr, sonarr)
 *
 * @apiSuccess {Object[]} results Array of missing item requests
 * @apiSuccess {Number} total Total number of matching requests
 * @apiSuccess {Number} limit Items per page
 * @apiSuccess {Number} offset Current offset
 */
missingItemsRoutes.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;
    const mediaType = req.query.mediaType as string;
    const collectionSource = req.query.collectionSource as string;
    const requestService = req.query.requestService as string;

    const repository = getRepository(MissingItemRequest);
    const queryBuilder = repository
      .createQueryBuilder('missing_item')
      .leftJoinAndSelect('missing_item.requestedBy', 'user')
      .orderBy('missing_item.createdAt', 'DESC');

    // Apply filters
    if (status) {
      queryBuilder.andWhere('missing_item.requestStatus = :status', { status });
    }
    if (mediaType) {
      queryBuilder.andWhere('missing_item.mediaType = :mediaType', {
        mediaType,
      });
    }
    if (collectionSource) {
      queryBuilder.andWhere(
        'missing_item.collectionSource = :collectionSource',
        { collectionSource }
      );
    }
    if (requestService) {
      queryBuilder.andWhere('missing_item.requestService = :requestService', {
        requestService,
      });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Get paginated results
    const results = await queryBuilder.limit(limit).offset(offset).getMany();

    res.status(200).json({
      results,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Failed to retrieve missing item requests', {
      label: 'Missing Items API',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * @api {get} /api/v1/missing-items/recent Get recent missing item requests
 * @apiName GetRecentMissingItems
 * @apiGroup MissingItems
 * @apiDescription Get the most recent missing item requests for dashboard display
 *
 * @apiParam {Number} [limit=5] Number of recent items to return
 *
 * @apiSuccess {Object[]} results Array of recent missing item requests
 */
missingItemsRoutes.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    const repository = getRepository(MissingItemRequest);
    const recentItems = await repository.find({
      relations: ['requestedBy'],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    res.status(200).json({ results: recentItems });
  } catch (error) {
    logger.error('Failed to retrieve recent missing item requests', {
      label: 'Missing Items API',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * @api {get} /api/v1/missing-items/stats Get missing item statistics
 * @apiName GetMissingItemStats
 * @apiGroup MissingItems
 * @apiDescription Get statistics about missing item requests
 *
 * @apiSuccess {Object} stats Statistics object
 * @apiSuccess {Number} stats.total Total number of requests
 * @apiSuccess {Number} stats.pending Number of pending requests
 * @apiSuccess {Number} stats.approved Number of approved requests
 * @apiSuccess {Number} stats.declined Number of declined requests
 * @apiSuccess {Number} stats.available Number of available requests
 * @apiSuccess {Object} stats.byMediaType Breakdown by media type
 * @apiSuccess {Object} stats.bySource Breakdown by collection source
 */
missingItemsRoutes.get('/stats', async (req, res) => {
  try {
    const repository = getRepository(MissingItemRequest);

    // Get total count
    const total = await repository.count();

    // Get status breakdown
    const statusBreakdown = await repository
      .createQueryBuilder('missing_item')
      .select('missing_item.requestStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('missing_item.requestStatus')
      .getRawMany();

    // Get media type breakdown
    const mediaTypeBreakdown = await repository
      .createQueryBuilder('missing_item')
      .select('missing_item.mediaType', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('missing_item.mediaType')
      .getRawMany();

    // Get source breakdown
    const sourceBreakdown = await repository
      .createQueryBuilder('missing_item')
      .select('missing_item.collectionSource', 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('missing_item.collectionSource')
      .getRawMany();

    // Format the response
    const stats = {
      total,
      pending: statusBreakdown.find((s) => s.status === 'pending')?.count || 0,
      approved:
        statusBreakdown.find((s) => s.status === 'approved')?.count || 0,
      declined:
        statusBreakdown.find((s) => s.status === 'declined')?.count || 0,
      available:
        statusBreakdown.find((s) => s.status === 'available')?.count || 0,
      processing:
        statusBreakdown.find((s) => s.status === 'processing')?.count || 0,
      failed: statusBreakdown.find((s) => s.status === 'failed')?.count || 0,
      partially_available:
        statusBreakdown.find((s) => s.status === 'partially_available')
          ?.count || 0,
      byMediaType: mediaTypeBreakdown.reduce((acc, item) => {
        acc[item.type] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      bySource: sourceBreakdown.reduce((acc, item) => {
        acc[item.source] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
    };

    res.status(200).json({ stats });
  } catch (error) {
    logger.error('Failed to retrieve missing item statistics', {
      label: 'Missing Items API',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * @api {post} /api/v1/missing-items/sync Sync missing item status
 * @apiName SyncMissingItemStatus
 * @apiGroup MissingItems
 * @apiDescription Sync status of missing item requests with Overseerr
 *
 * @apiSuccess {Object} result Sync result
 */
missingItemsRoutes.post('/sync', async (req, res) => {
  try {
    const { autoRequestService } = await import(
      '../lib/collections/services/AutoRequestService'
    );
    await autoRequestService.syncMissingItemStatus();
    res.status(200).json({ message: 'Missing item status sync completed' });
  } catch (error) {
    logger.error('Failed to sync missing item status', {
      label: 'Missing Items API',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ message: 'Failed to sync missing item status' });
  }
});

export default missingItemsRoutes;
