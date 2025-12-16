import logger from '@server/logger';
import { spawn } from 'child_process';
import fsPromises from 'fs/promises';
import path from 'path';
import type { TrailerDownloadOptions, VideoMetadata } from './types';

// Polyfill Intl.ListFormat if not available (needed for @sindresorhus/is in ts-node/CommonJS context)
// This must be done BEFORE any dynamic imports that might use it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(global as any).Intl.ListFormat) {
  // Simple polyfill that returns a basic formatter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).Intl.ListFormat = class ListFormat {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor() {}
    format(list: string[]): string {
      return list.join(', ');
    }
  };
}

interface YoutubeSearchResult {
  id: { videoId: string };
  snippet: { title: string };
}

// Cache the YouTube search module to avoid ES Module race conditions
let youtubeSearchModule: {
  search: (query: string) => Promise<YoutubeSearchResult[]>;
} | null = null;

async function getYoutubeSearch() {
  if (!youtubeSearchModule) {
    const imported = await import('youtube-search-without-api-key');
    // Handle both ESM and CommonJS module loading
    youtubeSearchModule = imported.default || imported;
  }
  return youtubeSearchModule;
}

/**
 * Extract video metadata using yt-dlp before downloading
 * This allows us to check duration and file size before committing to download
 */
async function extractVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    logger.debug('Extracting video metadata with yt-dlp', {
      label: 'Coming Soon Trailer',
      videoUrl,
    });

    // Use yt-dlp to extract metadata without downloading
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '-f',
      'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
      videoUrl,
    ]);

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
        try {
          const metadata = JSON.parse(stdoutOutput) as VideoMetadata;
          logger.debug('Successfully extracted video metadata', {
            label: 'Coming Soon Trailer',
            duration: metadata.duration,
            filesize: metadata.filesize,
            filesize_approx: metadata.filesize_approx,
            title: metadata.title,
          });
          resolve(metadata);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse yt-dlp metadata: ${
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError)
              }`
            )
          );
        }
      } else {
        logger.error('yt-dlp metadata extraction failed', {
          label: 'Coming Soon Trailer',
          code,
          stdout: stdoutOutput,
          stderr: stderrOutput,
        });
        reject(
          new Error(
            `yt-dlp metadata extraction exited with code ${code}: ${stderrOutput}`
          )
        );
      }
    });

    ytdlp.on('error', (error) => {
      logger.error('yt-dlp metadata extraction spawn error', {
        label: 'Coming Soon Trailer',
        error: error.message,
      });
      reject(error);
    });
  });
}

/**
 * Validate video metadata against configured limits
 * Returns true if video passes validation, false otherwise
 */
function validateVideoMetadata(
  metadata: VideoMetadata,
  options: TrailerDownloadOptions
): { valid: boolean; reason?: string } {
  const maxDuration = options.maxDuration || 300; // Default: 5 minutes
  const maxFileSize = options.maxFileSize || 314572800; // Default: 300 MB

  // Check duration
  if (metadata.duration > maxDuration) {
    return {
      valid: false,
      reason: `Video duration (${Math.round(
        metadata.duration
      )}s) exceeds maximum (${maxDuration}s)`,
    };
  }

  // Check file size (use filesize if available, otherwise filesize_approx)
  const estimatedSize = metadata.filesize || metadata.filesize_approx;
  if (estimatedSize && estimatedSize > maxFileSize) {
    const sizeMB = Math.round(estimatedSize / 1024 / 1024);
    const maxSizeMB = Math.round(maxFileSize / 1024 / 1024);
    return {
      valid: false,
      reason: `Video file size (~${sizeMB}MB) exceeds maximum (${maxSizeMB}MB)`,
    };
  }

  return { valid: true };
}

/**
 * Copy static placeholder video
 * This is used as a fallback when no trailer is found
 */
async function copyPlaceholderVideo(outputPath: string): Promise<void> {
  logger.debug('Using static placeholder video', {
    label: 'Coming Soon Trailer',
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
      label: 'Coming Soon Trailer',
      outputPath,
    });
  } catch (error) {
    logger.error('Failed to copy placeholder video', {
      label: 'Coming Soon Trailer',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Download YouTube video using yt-dlp
 * Uses yt-dlp binary which is more reliable than JavaScript libraries for YouTube downloads
 */
async function downloadWithYtDlp(
  videoUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug('Downloading with yt-dlp', {
      label: 'Coming Soon Trailer',
      videoUrl,
      outputPath,
    });

    // yt-dlp command with 1080p max resolution and automatic merging
    const ytdlp = spawn('yt-dlp', [
      '-f',
      'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath,
      videoUrl,
    ]);

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
          label: 'Coming Soon Trailer',
          outputPath,
        });
        resolve();
      } else {
        logger.error('yt-dlp download failed', {
          label: 'Coming Soon Trailer',
          code,
          stdout: stdoutOutput,
          stderr: stderrOutput,
        });
        reject(new Error(`yt-dlp exited with code ${code}: ${stderrOutput}`));
      }
    });

    ytdlp.on('error', (error) => {
      logger.error('yt-dlp spawn error', {
        label: 'Coming Soon Trailer',
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
    label: 'Coming Soon Trailer',
    title,
    year,
  });

  try {
    // Search YouTube for official trailer
    const searchQuery = `${title}${year ? ` ${year}` : ''} official trailer`;
    logger.debug('YouTube search query', {
      label: 'Coming Soon Trailer',
      query: searchQuery,
    });

    // Get cached YouTube search module to avoid ES Module race condition
    const youtubeSearchModule = await getYoutubeSearch();
    const searchResults = await youtubeSearchModule.search(searchQuery);

    if (!searchResults || searchResults.length === 0) {
      logger.warn('No YouTube trailers found, using fallback', {
        label: 'Coming Soon Trailer',
        title,
      });
      await copyPlaceholderVideo(outputPath);
      return;
    }

    // Get the first result (usually the official trailer)
    const firstResult = searchResults[0];
    const videoId = firstResult.id.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    logger.info('Found YouTube trailer', {
      label: 'Coming Soon Trailer',
      title,
      videoTitle: firstResult.snippet.title,
      videoId,
    });

    // Extract metadata before downloading to check duration and file size
    let metadata: VideoMetadata;
    try {
      metadata = await extractVideoMetadata(videoUrl);
    } catch (metadataError) {
      logger.warn('Failed to extract video metadata, using fallback', {
        label: 'Coming Soon Trailer',
        title,
        error:
          metadataError instanceof Error
            ? metadataError.message
            : String(metadataError),
      });
      await copyPlaceholderVideo(outputPath);
      return;
    }

    // Validate metadata against limits
    const validation = validateVideoMetadata(metadata, options);
    if (!validation.valid) {
      logger.warn('Video failed validation, using fallback', {
        label: 'Coming Soon Trailer',
        title,
        reason: validation.reason,
        duration: metadata.duration,
        filesize: metadata.filesize || metadata.filesize_approx,
      });
      await copyPlaceholderVideo(outputPath);
      return;
    }

    // Download trailer with yt-dlp (automatically handles 1080p video+audio and merging)
    logger.info('Downloading YouTube trailer in 1080p with yt-dlp', {
      label: 'Coming Soon Trailer',
      title,
      duration: Math.round(metadata.duration),
      estimatedSize: metadata.filesize || metadata.filesize_approx,
    });

    await downloadWithYtDlp(videoUrl, outputPath);

    logger.info('Successfully downloaded 1080p trailer', {
      label: 'Coming Soon Trailer',
      title,
      outputPath,
    });
  } catch (error) {
    logger.error('Failed to download YouTube trailer, using fallback', {
      label: 'Coming Soon Trailer',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      title,
    });
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
        label: 'Coming Soon Trailer',
        title,
        outputPath,
      });
      return outputPath;
    } catch {
      // Trailer doesn't exist, download it
    }

    logger.info('Downloading trailer', {
      label: 'Coming Soon Trailer',
      title,
      year,
      mediaType,
    });

    await searchAndDownloadTrailer({
      title,
      year,
      outputPath,
      maxDuration: 300, // 5 minutes max
      maxFileSize: 314572800, // 300 MB max
    });

    return outputPath;
  } catch (error) {
    logger.error('Failed to download trailer', {
      label: 'Coming Soon Trailer',
      error: error instanceof Error ? error.message : String(error),
      title,
      year,
    });
    throw error;
  }
}
