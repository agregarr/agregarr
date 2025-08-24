import type Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import type { PaginatedResponse } from './common';

export interface UserResultsResponse extends PaginatedResponse {
  results: User[];
}

export interface UserWatchDataResponse {
  recentlyWatched: Media[];
  playCount: number;
}
