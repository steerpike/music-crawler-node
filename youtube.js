const { google } = require('googleapis');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

/**
 * Create a YouTube client with the user's access token
 * @param {string} accessToken - Google OAuth access token
 * @returns {object} YouTube API client
 */
function createYouTubeClient(accessToken) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.youtube({
    version: 'v3',
    auth: oauth2Client
  });
}

/**
 * Create a new YouTube playlist
 * @param {string} accessToken - Google OAuth access token
 * @param {string} title - Playlist title
 * @param {string} description - Playlist description
 * @param {boolean} isPrivate - Whether the playlist is private
 * @returns {Promise<object>} Created playlist details
 */
async function createPlaylist(accessToken, title, description, isPrivate = true) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('youtube.create_playlist');

  try {
    span.setAttribute('playlist.title', title);
    span.setAttribute('playlist.privacy', isPrivate ? 'private' : 'public');

    const youtube = createYouTubeClient(accessToken);

    const response = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title,
          description
        },
        status: {
          privacyStatus: isPrivate ? 'private' : 'public'
        }
      }
    });

    span.setAttribute('playlist.id', response.data.id);
    span.end();

    return {
      success: true,
      playlist: response.data
    };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.code', error.code || 'unknown');
    span.setAttribute('error.message', error.message || 'Unknown error');
    span.end();

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Add a video to a playlist
 * @param {string} accessToken - Google OAuth access token
 * @param {string} playlistId - YouTube playlist ID
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<object>} Result of the operation
 */
async function addVideoToPlaylist(accessToken, playlistId, videoId) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('youtube.add_video_to_playlist');

  try {
    span.setAttribute('playlist.id', playlistId);
    span.setAttribute('video.id', videoId);

    const youtube = createYouTubeClient(accessToken);

    const response = await youtube.playlistItems.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId
          }
        }
      }
    });

    span.end();
    return {
      success: true,
      playlistItem: response.data
    };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.code', error.code || 'unknown');
    span.setAttribute('error.message', error.message || 'Unknown error');
    span.end();

    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  createPlaylist,
  addVideoToPlaylist
};
