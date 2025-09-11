import axios from 'axios';

/**
 * Fetch AniList data
 */
export const fetchAniListData = async (type: string, query: string) => {
  const response = await axios.get('/api/v1/anilist/list', {
    params: { type, query },
  });
  return response.data;
};
