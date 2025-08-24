import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { UserResultsResponse } from '@server/interfaces/api/userInterfaces';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const userRoutes = Router();

// Simplified user routes for Agregarr - removed Overseerr user management features
// Focus on basic Plex authentication and user info

userRoutes.get('/', isAuthenticated(), async (req, res) => {
  const pageSize = req.query.take ? Number(req.query.take) : 10;
  const skip = req.query.skip ? Number(req.query.skip) : 0;

  const userRepository = getRepository(User);

  const [users, userCount] = await userRepository.findAndCount({
    order: {
      id: 'ASC',
    },
    take: pageSize,
    skip,
  });

  return res.status(200).json({
    pageInfo: {
      pages: Math.ceil(userCount / pageSize),
      pageSize,
      results: userCount,
      page: Math.floor(skip / pageSize) + 1,
    },
    results: users.map((user) => user.filter()),
  } as UserResultsResponse);
});

userRoutes.get('/:id', isAuthenticated(), async (req, res, next) => {
  const userRepository = getRepository(User);

  try {
    const user = await userRepository.findOneOrFail({
      where: { id: Number(req.params.id) },
    });

    return res.status(200).json(user.filter());
  } catch (e) {
    return next({
      status: 404,
      message: 'User not found.',
    });
  }
});

userRoutes.get(
  '/:id/settings/main',
  isAuthenticated(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Simplified - just return basic user settings
      return res.status(200).json({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
      });
    } catch (e) {
      return next({
        status: 404,
        message: 'User not found.',
      });
    }
  }
);

userRoutes.post(
  '/:id/settings/main',
  isAuthenticated(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Only allow basic profile updates
      if (req.body.username) user.username = req.body.username;
      if (req.body.displayName) user.displayName = req.body.displayName;
      if (req.body.email) user.email = req.body.email;

      await userRepository.save(user);

      return res.status(200).json({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
      });
    } catch (e) {
      return next({
        status: 404,
        message: 'User not found.',
      });
    }
  }
);

// Stub out other endpoints that were removed
userRoutes.get('/:id/quota', isAuthenticated(), async (req, res) => {
  // Quota system removed for Agregarr
  return res.status(200).json({
    movie: { remaining: 0, limit: 0, days: 0 },
    tv: { remaining: 0, limit: 0, days: 0 },
  });
});

userRoutes.get('/:id/requests', isAuthenticated(), async (req, res) => {
  // Request system removed for Agregarr
  return res.status(200).json({
    pageInfo: { pages: 1, pageSize: 20, results: 0, page: 1 },
    results: [],
  });
});

userRoutes.get('/:id/watchdata', isAuthenticated(), async (req, res) => {
  // Watch data simplified for Agregarr
  return res.status(200).json({
    recentlyWatched: [],
    playCount: 0,
  });
});

export default userRoutes;
