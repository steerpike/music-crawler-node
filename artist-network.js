const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { db, artists } = require('./db');

/**
 * Collects videos from an artist and their related artists, then returns a random selection
 * @param {string} artistName - Name of the main artist
 * @param {number} maxRelatedArtists - Maximum number of related artists to include
 * @param {number} resultCount - Number of videos to return
 * @param {object} parentSpan - Optional parent span for tracing
 * @returns {Promise<object>} Result object with randomly selected videos
 */
async function getRandomVideosFromArtistNetwork(artistName, maxRelatedArtists = 100, resultCount = 50, parentSpan = null) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('get_random_videos_from_network',
    parentSpan ? { parent: parentSpan } : undefined);

  try {
    span.setAttribute('artist.name', artistName);
    span.setAttribute('max_related_artists', maxRelatedArtists);
    span.setAttribute('result_count', resultCount);

    // Find the main artist
    const mainArtist = await findArtist(artistName, span);
    if (!mainArtist) {
      span.addEvent('main_artist_not_found');
      return { success: false, error: 'Artist not found' };
    }

    // Step 1: Collect all artists and their videos
    const artistsWithVideos = [];
    const processedArtistUrls = new Set();

    // Add main artist
    const mainArtistWithVideos = await collectArtistWithVideos(mainArtist, processedArtistUrls, span);
    if (mainArtistWithVideos) {
      artistsWithVideos.push(mainArtistWithVideos);
    }

    // Step 2: Find related artists
    const relatedArtistsQuery = `
      SELECT a.*
      FROM Artists a
      JOIN Similar_Artists sa ON a.Url = sa.RelatedArtistUrl
      WHERE sa.ArtistUrl = ?
      LIMIT ?
    `;

    const relatedArtists = await new Promise((resolve, reject) => {
      db.all(relatedArtistsQuery, [mainArtist.Url, 100], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });

    span.setAttribute('related_artists.count', relatedArtists.length);
    span.addEvent('related_artists_found');

    // Step 3: Collect videos from related artists
    for (const relatedArtist of relatedArtists) {
      const artistWithVideos = await collectArtistWithVideos(relatedArtist, processedArtistUrls, span);
      if (artistWithVideos) {
        artistsWithVideos.push(artistWithVideos);
      }
    }

    // Get total video count
    let totalVideosFound = 0;
    artistsWithVideos.forEach(artist => {
      totalVideosFound += artist.videos.length;
    });

    span.setAttribute('total_videos.count', totalVideosFound);
    span.setAttribute('artists_with_videos.count', artistsWithVideos.length);

    if (totalVideosFound === 0) {
      span.addEvent('no_videos_found');
      return {
        success: false,
        error: 'No videos found for artist or related artists'
      };
    }

    // Step 4: Get a balanced selection of videos across artists
    const selectedVideos = getBalancedVideoSelection(artistsWithVideos, resultCount, span);

    span.addEvent('balanced_videos_selected');
    span.setAttribute('selected_videos.count', selectedVideos.length);

    // Count videos per artist in selection for debugging
    const artistCounts = {};
    selectedVideos.forEach(video => {
      artistCounts[video.artistId] = (artistCounts[video.artistId] || 0) + 1;
    });

    return {
      success: true,
      artist: mainArtist.Name,
      relatedArtistsCount: relatedArtists.length,
      totalVideosFound,
      artistDistribution: artistCounts,
      videos: selectedVideos
    };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    console.error('Error getting random videos from network:', error);
    return { success: false, error: 'Unexpected error', message: error.message };
  } finally {
    span.end();
  }
}

/**
 * Collects videos for a specific artist
 * @param {object} artist - Artist object
 * @param {Set} processedArtistUrls - Set of already processed artist URLs
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Promise<object|null>} Artist with videos or null
 */
async function collectArtistWithVideos(artist, processedArtistUrls, parentSpan) {
  // Skip if already processed
  if (processedArtistUrls.has(artist.Url)) {
    return null;
  }

  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('collect_artist_with_videos', { parent: parentSpan });

  try {
    span.setAttribute('artist.name', artist.Name);
    span.setAttribute('artist.id', artist.ID);

    // Mark as processed to avoid duplicates
    processedArtistUrls.add(artist.Url);

    const videosQuery = `
      SELECT v.*
      FROM Videos v
      JOIN Artist_Videos av ON v.Url = av.VideoUrl
      WHERE av.ArtistUrl = ?
    `;

    const videos = await new Promise((resolve, reject) => {
      db.all(videosQuery, [artist.Url], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });

    span.setAttribute('artist_videos.count', videos.length);

    // Return artist with videos
    const result = {
      id: artist.ID,
      name: artist.Name,
      url: artist.Url,
      videos: videos
    };

    span.end();
    return result;
  } catch (error) {
    span.recordException(error);
    span.end();
    console.error(`Error collecting videos for ${artist.Name}:`, error);
    return null;
  }
}

/**
 * Find an artist by name
 * @param {string} name - Artist name
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Promise<object|null>} Artist object or null if not found
 */
async function findArtist(name, parentSpan) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('find_artist', { parent: parentSpan });

  try {
    span.setAttribute('artist.name', name);
    const artist = await artists.findByNameWithAliases(name);
    span.setAttribute('artist.found', !!artist);
    span.end();
    return artist;
  } catch (error) {
    span.recordException(error);
    span.end();
    throw error;
  }
}

/**
 * Collects all videos for a specific artist
 * @param {object} artist - Artist object
 * @param {Array} videosArray - Array to collect videos into
 * @param {Set} processedArtists - Set of already processed artist URLs
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Promise<void>}
 */
async function collectArtistVideos(artist, videosArray, processedArtists, parentSpan) {
  // Skip if already processed
  if (processedArtists.has(artist.Url)) {
    return;
  }

  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('collect_artist_videos', { parent: parentSpan });

  try {
    span.setAttribute('artist.name', artist.Name);

    // Mark as processed to avoid duplicates
    processedArtists.add(artist.Url);

    const videosQuery = `
      SELECT v.*
      FROM Videos v
      JOIN Artist_Videos av ON v.Url = av.VideoUrl
      WHERE av.ArtistUrl = ?
    `;

    const videos = await new Promise((resolve, reject) => {
      db.all(videosQuery, [artist.Url], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });

    span.setAttribute('artist_videos.count', videos.length);

    // Add artist attribution to each video
    videos.forEach(video => {
      videosArray.push({
        ...video,
        artistName: artist.Name,
        artistUrl: artist.Url
      });
    });
  } catch (error) {
    span.recordException(error);
    console.error(`Error collecting videos for ${artist.Name}:`, error);
  } finally {
    span.end();
  }
}

/**
 * Shuffle an array and return a subset of random elements
 * @param {Array} array - Input array
 * @param {number} count - Number of elements to return
 * @returns {Array} Randomly selected elements
 */
function shuffleAndSelect(array, count) {
  // Fisher-Yates shuffle algorithm
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Return requested count or all if array is smaller
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Creates a YouTube playlist with random videos from an artist network
 * @param {string} artistName - Name of the artist
 * @param {string} accessToken - YouTube API access token
 * @param {object} youtube - YouTube API module
 * @param {number} maxRelated - Maximum number of related artists
 * @param {number} count - Number of videos to include
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Promise<object>} Playlist creation result
 */
async function createRandomPlaylistForArtist(artistName, accessToken, youtube, maxRelated = 5, count = 20, parentSpan = null) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('create_random_playlist',
    parentSpan ? { parent: parentSpan } : undefined);

  try {
    span.setAttribute('artist.name', artistName);
    span.setAttribute('max_related', maxRelated);
    span.setAttribute('count', count);

    // Get random videos from artist network
    const randomVideos = await getRandomVideosFromArtistNetwork(artistName, maxRelated, count, span);

    if (!randomVideos.success) {
      span.addEvent('no_videos_found');
      return randomVideos;
    }

    // Create the playlist
    const playlistTitle = `${artistName} and Similar Artists Mix`;
    const playlistDescription = `A playlist of ${artistName} and ${randomVideos.relatedArtistsCount} related artists created by Music Crawler`;
    const isPrivate = false;

    span.setAttribute('playlist.title', playlistTitle);
    span.setAttribute('playlist.description', playlistDescription);

    // Create YouTube playlist
    const playlistResult = await youtube.createPlaylist(
      accessToken,
      playlistTitle,
      playlistDescription,
      isPrivate
    );

    if (!playlistResult.success) {
      span.addEvent('playlist_creation_failed');
      return {
        success: false,
        error: 'Failed to create playlist',
        details: playlistResult.error
      };
    }

    const playlistId = playlistResult.playlist.id;
    span.setAttribute('playlist.id', playlistId);

    // Extract YouTube video IDs from video URLs and add to playlist
    const addedVideos = [];
    const failedVideos = [];

    // Process videos sequentially to avoid rate limiting
    for (const video of randomVideos.videos) {
      // Extract YouTube ID from URL if possible
      const videoIdMatch = video.Url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]+)/);
      if (!videoIdMatch) {
        failedVideos.push({
          name: video.Name,
          url: video.Url,
          reason: 'Not a YouTube URL or ID extraction failed'
        });
        continue;
      }

      const videoId = videoIdMatch[1];

      try {
        // Add to playlist
        const addResult = await youtube.addVideoToPlaylist(accessToken, playlistId, videoId);

        if (addResult.success) {
          addedVideos.push({
            name: video.Name,
            videoId,
            artistName: video.artistName
          });
        } else {
          failedVideos.push({
            name: video.Name,
            videoId,
            reason: addResult.error
          });
        }
      } catch (videoError) {
        failedVideos.push({
          name: video.Name,
          videoId,
          reason: videoError.message
        });
      }
    }

    span.setAttribute('videos.added', addedVideos.length);
    span.setAttribute('videos.failed', failedVideos.length);

    // Return the results
    return {
      success: true,
      playlist: {
        id: playlistId,
        title: playlistTitle,
        url: `https://www.youtube.com/playlist?list=${playlistId}`
      },
      stats: {
        totalVideosFound: randomVideos.totalVideosFound,
        videosAdded: addedVideos.length,
        videosFailed: failedVideos.length
      },
      addedVideos,
      failedVideos
    };

  } catch (error) {
    span.recordException(error);
    console.error('Error creating random playlist:', error);
    return { success: false, error: 'Server error', message: error.message };
  } finally {
    span.end();
  }
}

/**
 * Get a balanced selection of videos from across artists
 * @param {Array} artistsWithVideos - Array of artists with their videos
 * @param {number} targetCount - Desired number of videos
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Array} Balanced selection of videos
 */
function getBalancedVideoSelection(artistsWithVideos, targetCount, parentSpan) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('get_balanced_video_selection', { parent: parentSpan });

  try {
    // Calculate how many videos we want per artist
    const totalArtists = artistsWithVideos.length;
    span.setAttribute('total_artists', totalArtists);

    if (totalArtists === 0) {
      span.end();
      return [];
    }

    // Get at least one video per artist if possible
    let selectedVideos = [];
    const remainingArtists = [...artistsWithVideos];

    // First ensure we have good artist diversity by taking one random video from each artist
    remainingArtists.forEach(artist => {
      if (artist.videos.length > 0) {
        // Shuffle artist's videos
        const shuffledVideos = shuffleArray(artist.videos);
        // Take one random video
        selectedVideos.push({
          ...shuffledVideos[0],
          artistName: artist.name,
          artistUrl: artist.url,
          artistId: artist.id
        });
      }
    });

    span.setAttribute('initial_selection_count', selectedVideos.length);

    // If we need more videos to reach target count
    if (selectedVideos.length < targetCount) {
      const remaining = targetCount - selectedVideos.length;

      // Create a pool from the remaining videos across all artists
      const remainingVideoPool = [];
      remainingArtists.forEach(artist => {
        if (artist.videos.length > 1) {
          // Skip the first video that we've already selected
          for (let i = 1; i < artist.videos.length; i++) {
            remainingVideoPool.push({
              ...artist.videos[i],
              artistName: artist.name,
              artistUrl: artist.url,
              artistId: artist.id
            });
          }
        }
      });

      // Shuffle the remaining pool and take what we need
      const shuffledPool = shuffleArray(remainingVideoPool);

      // Use a weighted selection to avoid overrepresenting any single artist
      const additionalVideos = selectWithArtistWeighting(shuffledPool, remaining);
      selectedVideos = [...selectedVideos, ...additionalVideos];
    }

    // If we have too many videos, truncate
    if (selectedVideos.length > targetCount) {
      selectedVideos = shuffleArray(selectedVideos).slice(0, targetCount);
    }

    span.setAttribute('final_selection_count', selectedVideos.length);
    span.end();
    return selectedVideos;
  } catch (error) {
    span.recordException(error);
    span.end();
    console.error('Error creating balanced video selection:', error);
    return [];
  }
}

/**
 * Select videos with weighting to prevent any artist from being overrepresented
 * @param {Array} videoPool - Pool of videos to select from
 * @param {number} count - Number of videos to select
 * @returns {Array} Selected videos
 */
function selectWithArtistWeighting(videoPool, count) {
  if (videoPool.length <= count) {
    return videoPool;
  }

  // Keep track of how many videos we've selected per artist
  const artistCounts = {};
  const selected = [];

  // Create a copy of the pool that we can modify
  let remainingPool = [...videoPool];

  while (selected.length < count && remainingPool.length > 0) {
    // Sort remaining pool by artist representation (ascending)
    remainingPool.sort((a, b) => {
      const countA = artistCounts[a.artistId] || 0;
      const countB = artistCounts[b.artistId] || 0;
      return countA - countB;
    });

    // Take videos from least represented artists first
    const nextVideo = remainingPool.shift();
    selected.push(nextVideo);

    // Update the count for this artist
    artistCounts[nextVideo.artistId] = (artistCounts[nextVideo.artistId] || 0) + 1;
  }

  return selected;
}

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}


module.exports = {
  getRandomVideosFromArtistNetwork,
  createRandomPlaylistForArtist
};
