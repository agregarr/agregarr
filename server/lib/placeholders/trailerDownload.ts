import logger from '@server/logger';
import { spawn } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import type { TrailerDownloadOptions } from './types';

/**
 * yt-dlp cookie arguments, if config/youtube-cookies.txt exists
 */
function youtubeCookieArgs(): string[] {
  const cookiesPath = path.join(process.cwd(), 'config', 'youtube-cookies.txt');
  try {
    fs.accessSync(cookiesPath);
    logger.debug('Using YouTube cookies', {
      label: 'PlaceholderService',
      cookiesPath,
    });
    return ['--cookies', cookiesPath];
  } catch {
    // Cookies file doesn't exist, continue without it
    logger.debug('No YouTube cookies file found, proceeding without cookies', {
      label: 'PlaceholderService',
      expectedPath: cookiesPath,
    });
    return [];
  }
}

/**
 * Find the first YouTube result for a query with yt-dlp's search
 */
function searchYouTube(
  query: string
): Promise<{ videoId: string; title: string } | null> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(
      'yt-dlp',
      [
        '--flat-playlist',
        '--no-warnings',
        '--print',
        '%(id)s\t%(title)s',
        ...youtubeCookieArgs(),
        `ytsearch1:${query}`,
      ],
      { timeout: 30000 }
    );
    let stdout = '';
    let stderr = '';
    ytdlp.stdout.on('data', (data) => (stdout += data.toString()));
    ytdlp.stderr.on('data', (data) => (stderr += data.toString()));
    ytdlp.on('error', reject);
    ytdlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp search exited with code ${code}: ${stderr}`));
        return;
      }
      const line = stdout.trim().split('\n')[0];
      if (!line) {
        resolve(null);
        return;
      }
      const [videoId, ...rest] = line.split('\t');
      resolve({ videoId, title: rest.join('\t') });
    });
  });
}

/**
 * Copy static placeholder video
 * This is used as a fallback when no trailer is found
 */
async function copyPlaceholderVideo(outputPath: string): Promise<void> {
  logger.debug('Using static placeholder video', {
    label: 'PlaceholderService',
    outputPath,
  });

  try {
    // Use bundled placeholder video from public/assets
    const placeholderPath = path.join(
      process.cwd(),
      'public',
      'assets',
      'placeholder.mp4'
    );
    await fsPromises.copyFile(placeholderPath, outputPath);

    logger.info('Copied static placeholder video', {
      label: 'PlaceholderService',
      outputPath,
    });
  } catch (error) {
    logger.error('Failed to copy placeholder video', {
      label: 'PlaceholderService',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Download YouTube video using yt-dlp with duration filtering
 * Uses yt-dlp binary which is more reliable than JavaScript libraries for YouTube downloads
 * Duration filter rejects videos over 3.5 minutes (210s) to avoid compilation videos
 */
async function downloadWithYtDlp(
  videoUrl: string,
  outputPath: string,
  maxDuration = 210
): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug('Downloading with yt-dlp', {
      label: 'PlaceholderService',
      videoUrl,
      outputPath,
      maxDuration,
    });

    // Build yt-dlp arguments with duration filter
    // Note: duration must be filtered using --match-filter, not in format selector
    const args = [
      '--break-on-reject',
      '--match-filter',
      `duration < ${maxDuration}`,
      '-f',
      'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath,
    ];

    args.push(...youtubeCookieArgs(), videoUrl);

    // yt-dlp command with 1080p max resolution, duration filter, and automatic merging
    const ytdlp = spawn('yt-dlp', args);

    let stdoutOutput = '';
    let stderrOutput = '';

    ytdlp.stdout.on('data', (data) => {
      stdoutOutput += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0) {
        logger.info('Successfully downloaded trailer with yt-dlp', {
          label: 'PlaceholderService',
          outputPath,
        });
        resolve();
      } else {
        // Check if this is a duration filter rejection (code 101)
        const isDurationFilterRejection =
          code === 101 && stdoutOutput.includes('does not pass filter');

        if (isDurationFilterRejection) {
          // Extract video title from stdout if available
          const titleMatch = stdoutOutput.match(
            /\[download\] (.+?) does not pass filter/
          );
          const videoTitle = titleMatch ? titleMatch[1] : 'Video';

          logger.info('Video rejected by duration filter (over 3.5 minutes)', {
            label: 'PlaceholderService',
            videoTitle,
            maxDuration: maxDuration,
          });
        } else {
          // Actual error (network, bot detection, etc.)
          logger.error('yt-dlp download failed', {
            label: 'PlaceholderService',
            code,
            stdout: stdoutOutput,
            stderr: stderrOutput,
          });
        }

        reject(new Error(`yt-dlp exited with code ${code}: ${stderrOutput}`));
      }
    });

    ytdlp.on('error', (error) => {
      logger.error('yt-dlp spawn error', {
        label: 'PlaceholderService',
        error: error.message,
      });
      reject(error);
    });
  });
}

/**
 * Search for trailer on YouTube and download it
 */
async function searchAndDownloadTrailer(
  options: TrailerDownloadOptions
): Promise<void> {
  const { title, year, outputPath } = options;

  logger.info('Searching for YouTube trailer', {
    label: 'PlaceholderService',
    title,
    year,
  });

  try {
    // Search YouTube for official trailer
    const searchQuery = `${title}${year ? ` ${year}` : ''} official trailer`;
    logger.debug('YouTube search query', {
      label: 'PlaceholderService',
      query: searchQuery,
    });

    const firstResult = await searchYouTube(searchQuery);

    if (!firstResult) {
      logger.warn('No YouTube trailers found, using fallback', {
        label: 'PlaceholderService',
        title,
      });
      await copyPlaceholderVideo(outputPath);
      return;
    }

    const videoId = firstResult.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    logger.info('Found YouTube trailer', {
      label: 'PlaceholderService',
      title,
      videoTitle: firstResult.title,
      videoId,
    });

    // Download trailer with yt-dlp (includes duration filter to reject videos over 3.5 minutes)
    const maxDuration = options.maxDuration || 210; // Default: 3.5 minutes
    logger.info('Downloading YouTube trailer with yt-dlp', {
      label: 'PlaceholderService',
      title,
      maxDuration,
    });

    await downloadWithYtDlp(videoUrl, outputPath, maxDuration);

    logger.info('Successfully downloaded 1080p trailer', {
      label: 'PlaceholderService',
      title,
      outputPath,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isDurationFilterRejection =
      errorMessage.includes('code 101') &&
      errorMessage.includes('does not pass filter');

    if (isDurationFilterRejection) {
      // Video was rejected by duration filter (too long)
      logger.info(
        'Trailer video too long (over 3.5 minutes), using placeholder instead',
        {
          label: 'PlaceholderService',
          title,
        }
      );
    } else {
      // Actual error (network, bot detection, etc.)
      logger.error('Failed to download YouTube trailer, using fallback', {
        label: 'PlaceholderService',
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        title,
      });
    }
    // Fallback to placeholder video if download fails
    await copyPlaceholderVideo(outputPath);
  }
}

/**
 * Download trailer for a movie or TV show
 * Returns path to downloaded trailer file
 */
export async function downloadTrailer(
  title: string,
  year?: number,
  mediaType: 'movie' | 'tv' = 'movie'
): Promise<string> {
  const tempDir = path.join(process.cwd(), 'config', 'temp', 'trailers');

  try {
    // Ensure temp directory exists
    await fsPromises.mkdir(tempDir, { recursive: true });

    // Generate output filename
    const sanitizedTitle = title
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_');
    const yearStr = year ? `_${year}` : '';
    const filename = `${sanitizedTitle}${yearStr}_trailer.mp4`;
    const outputPath = path.join(tempDir, filename);

    // Check if trailer already exists
    try {
      await fsPromises.access(outputPath);
      logger.debug('Trailer already exists in cache', {
        label: 'PlaceholderService',
        title,
        outputPath,
      });
      return outputPath;
    } catch {
      // Trailer doesn't exist, download it
    }

    // Check if YouTube trailer downloads are disabled
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    const skipYoutubeDownload = settings.main.skipYoutubeTrailerDownloads;

    if (skipYoutubeDownload) {
      logger.info(
        'YouTube trailer downloads disabled - using hardcoded placeholder video',
        {
          label: 'PlaceholderService',
          title,
          year,
          mediaType,
        }
      );

      // Copy hardcoded placeholder video directly
      await copyPlaceholderVideo(outputPath);
      return outputPath;
    }

    logger.info('Downloading trailer', {
      label: 'PlaceholderService',
      title,
      year,
      mediaType,
    });

    await searchAndDownloadTrailer({
      title,
      year,
      outputPath,
      maxDuration: 210, // 3.5 minutes max (avoids compilation videos)
    });

    return outputPath;
  } catch (error) {
    logger.error('Failed to download trailer', {
      label: 'PlaceholderService',
      error: error instanceof Error ? error.message : String(error),
      title,
      year,
    });
    throw error;
  }
}
