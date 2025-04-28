require('dotenv').config();
require('./tracing.js');
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const passport = require('passport');
const artistNetwork = require('./artist-network');
const youtube = require('./youtube');
const session = require('express-session');
const GoogleStrategy = require('passport-google-oauth2').Strategy;
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { artists, queue } = require('./db');
const musicmap = require('./musicmap');

const app = express();
const PORT = process.env.PORT || 3000;

const crawlQueue = new Map();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  profile.refreshToken = refreshToken;
  done(null, profile);
}));
app.use(express.json());

passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user, done) => {
  done(null, user);
});

app.get('/', (req, res) => {
  res.send('Welcome to the Music Crawler API! <a href="/auth/google">Login with Google</a>');
});

app.get('/auth/google', passport.authenticate('google', {
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/youtube'
  ]
}));

app.get('/auth/google/callback', passport.authenticate('google', {
  successRedirect: '/profile',
  failureRedirect: '/'
}));

app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.send(`Hello ${req.user.displayName}! <a href="/logout">Logout</a>`);
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error logging out:', err);
    }
    res.redirect('/');
  });
});


app.get('/query/:name/random-videos', async (req, res) => {
  const artistName = req.params.name;
  const maxRelated = parseInt(req.query.maxRelated || '5', 10);
  const count = parseInt(req.query.count || '20', 10);

  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('random_videos_endpoint');

  try {
    span.setAttribute('artist.name', artistName);

    const result = await artistNetwork.getRandomVideosFromArtistNetwork(
      artistName,
      maxRelated,
      count,
      span
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    span.recordException(error);
    console.error('Error in random videos endpoint:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    span.end();
  }
});

app.get('/playlist/:name', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { accessToken } = req.user;
  const artistName = req.params.name;
  const maxRelated = parseInt(req.query.maxRelated || '5', 10);
  const videoCount = parseInt(req.query.count || '20', 10);

  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('create_network_playlist');

  try {
    span.setAttribute('artist.name', artistName);
    span.setAttribute('max_related', maxRelated);
    span.setAttribute('video_count', videoCount);

    // Check if the artist exists in our database
    const artist = await findArtist(artistName, span);
    if (!artist) {
      span.addEvent('artist_not_found');
      return res.status(404).json({
        success: false,
        error: 'Artist not found',
        message: 'Artist not found in the database'
      });
    }

    span.addEvent('artist_found');
    span.setAttribute('artist.id', artist.ID);

    // Create a dynamic playlist title and description
    const playlistTitle = `${artistName} and Similar Artists Mix`;
    const playlistDescription = `A playlist of ${artistName} and related artists created by Music Crawler`;
    const isPrivate = false;

    span.setAttribute('playlist.title', playlistTitle);
    span.setAttribute('playlist.description', playlistDescription);

    // Get random videos from the artist network
    span.addEvent('fetching_network_videos');
    const videosResult = await artistNetwork.getRandomVideosFromArtistNetwork(
      artistName,
      maxRelated,
      videoCount,
      span
    );

    if (!videosResult.success || videosResult.videos.length === 0) {
      span.addEvent('no_videos_found');
      return res.status(404).json({
        success: false,
        error: 'No videos found',
        message: 'Could not find any videos for this artist and related artists'
      });
    }

    span.setAttribute('videos.found', videosResult.videos.length);
    span.addEvent('creating_playlist');

    // Create the YouTube playlist
    const playlistResult = await youtube.createPlaylist(
      accessToken,
      playlistTitle,
      playlistDescription,
      isPrivate
    );

    if (!playlistResult.success) {
      span.addEvent('playlist_creation_failed');
      span.setAttribute('error.message', playlistResult.error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create playlist',
        message: playlistResult.error
      });
    }

    const playlistId = playlistResult.playlist.id;
    span.setAttribute('playlist.id', playlistId);
    span.addEvent('playlist_created');

    // Add videos to the playlist
    const addedVideos = [];
    const failedVideos = [];

    for (const video of videosResult.videos) {
      // Extract YouTube video ID from URL
      const videoIdMatch = video.Url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]+)/);

      if (!videoIdMatch) {
        failedVideos.push({
          name: video.Name,
          artistName: video.artistName,
          url: video.Url,
          reason: 'Not a valid YouTube URL'
        });
        continue;
      }

      const videoId = videoIdMatch[1];

      try {
        const addResult = await youtube.addVideoToPlaylist(accessToken, playlistId, videoId);

        if (addResult.success) {
          addedVideos.push({
            name: video.Name,
            artistName: video.artistName,
            videoId
          });
          span.addEvent('video_added_to_playlist');
        } else {
          failedVideos.push({
            name: video.Name,
            artistName: video.artistName,
            videoId,
            reason: addResult.error
          });
          span.addEvent('video_add_failed');
        }
      } catch (error) {
        span.recordException(error);
        failedVideos.push({
          name: video.Name,
          artistName: video.artistName,
          videoId,
          reason: error.message
        });
      }
    }

    span.setAttribute('videos.added', addedVideos.length);
    span.setAttribute('videos.failed', failedVideos.length);

    // Return the results
    res.status(200).json({
      success: true,
      playlist: {
        id: playlistId,
        title: playlistTitle,
        url: `https://www.youtube.com/playlist?list=${playlistId}`
      },
      stats: {
        totalVideosFound: videosResult.totalVideosFound,
        relatedArtistsCount: videosResult.relatedArtistsCount,
        videosAdded: addedVideos.length,
        videosFailed: failedVideos.length
      },
      addedVideos,
      failedVideos
    });

  } catch (error) {
    span.recordException(error);
    console.error('Error creating network playlist:', error);
    res.status(500).json({
      success: false,
      error: 'Server error',
      message: error.message
    });
  } finally {
    span.end();
  }
});

app.get('/artist/:name', async (req, res) => {
  const userInput = req.params.name;
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('get_artist_route');

  try {
    span.setAttribute('artist.name', userInput);
    const artist = await findArtist(userInput, span);

    if (artist) {
      span.addEvent('artist_found_in_db');
      res.status(200).json(artist);
    } else {
      triggerBackgroundCrawl(userInput, span);
      res.status(404).json({
        error: 'Artist not found',
        message: 'We\'re fetching data for this artist. Try again soon.'
      });
    }
  } catch (error) {
    span.recordException(error);
    console.error('Error in /artist route:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    span.end();
  }
});

app.get('/process-queue', async (req, res) => {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('process_queue');
  try {
    // Get next batch of artists to crawl
    const batch = await queue.getNextBatch(5);
    if (batch.length === 0) {
      res.status(200).json({ message: 'No artists in queue' });
      return;
    }
    for (const item of batch) {
      console.log(`Processing queued artist: ${item.ArtistName}`);
      // Mark as in progress
      await queue.updateStatus(item.ID, 'in_progress');

      try {
        const artist = await findArtist(item.ArtistName, span);
        if (artist) {
          span.addEvent('artist_found_in_db');
          res.status(200).json(artist);
        } else {
          const result = await crawlArtist(item.ArtistName);
          await artists.saveWithVideos(result.artist);
          span.addEvent('artist_saved');
          artists.saveRelatedArtist(item.SourceArtistUrl, result.artist.url);
        }
        // Mark as completed
        await queue.updateStatus(item.ID, 'completed');
        span.setAttribute('artist.updated', item.ArtistName);
      } catch (error) {
        console.error(`Error processing ${item.ArtistName}:`, error);
        span.recordException(error);
        await queue.updateStatus(item.ID, 'error', error.message);
      }
    }
  } catch (error) {
    console.error('Error processing queue:', error);
    span.recordException(error);
    res.status(500).json({ error: 'Server error processing queue' });
  }
  // Log queue statistics
  const stats = await queue.getStats();
  console.log('Queue stats:', stats);
  res.status(200).json(stats);
});

/**
 * Find an artist in the database
 * @param {string} artistName - Name of the artist to find
 * @param {object} parentSpan - Parent span for tracing
 * @returns {Promise<object|null>} Artist object or null if not found
 */
async function findArtist(artistName, parentSpan) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('find_artist', { parent: parentSpan });

  try {
    span.setAttribute('artist.name', artistName);
    const artist = await artists.findByNameWithAliases(artistName);
    span.setAttribute('artist.found', !!artist);
    return artist;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Trigger an artist crawl in the background
 * @param {string} artistName - Name of artist to crawl
 * @param {object} parentSpan - Parent span for tracing
 */
function triggerBackgroundCrawl(artistName, parentSpan) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('trigger_background_crawl', { parent: parentSpan });

  try {
    // Only crawl if not already in progress
    if (crawlQueue.has(artistName)) {
      span.addEvent('crawl_already_in_queue');
      console.log(`Crawl already in progress for: ${artistName}`);
      return;
    }

    // Mark as crawling and start the process
    crawlQueue.set(artistName, true);
    span.addEvent('crawl_started');
    console.log(`Starting crawl for artist: ${artistName}`);

    // Execute crawl in background
    processCrawl(artistName);
  } catch (error) {
    span.recordException(error);
    console.error(`Error triggering crawl for ${artistName}:`, error);
  } finally {
    span.end();
  }
}

/**
 * Process the actual artist crawl
 * @param {string} artistName - Name of artist to crawl
 */
async function processCrawl(artistName) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('process_crawl');

  try {
    span.setAttribute('artist.name', artistName);

    // Perform the crawl
    const result = await crawlArtist(artistName);

    if (result.success) {
      span.addEvent('crawl_successful');
      console.log(`Crawl successful for: ${artistName}`);

      try {
        const res = await artists.saveWithVideos(result.artist);
        span.addEvent('artist_saved');
        const related = await musicmap.fetchRelatedArtists(result.artist.name, span);
        if(related.success) {
          related.relatedArtists.forEach(async (relatedArtist) => {
            await queue.saveToQueue(relatedArtist.name, result.artist.url);
          })
        }
      } catch (saveError) {
        span.recordException(saveError);
        console.error(`Failed to save artist: ${saveError.message}`);
      }
    } else {
      span.addEvent('crawl_failed');
      span.setAttribute('error.reason', result.error);
      console.error(`Failed to crawl artist ${artistName}: ${result.error}`);
    }
  } catch (error) {
    span.recordException(error);
    console.error(`Unexpected error during crawl for ${artistName}:`, error);
  } finally {
    // Always clear from queue when finished
    crawlQueue.delete(artistName);
    span.end();
  }
}

async function fetchLastFmData(artistName, span) {
  const encodedArtistName = encodeURIComponent(artistName);
  const url = `https://www.last.fm/music/${encodedArtistName}/+tracks`;
  span.setAttribute('request.url', url);

  const response = await axios.get(url, {
    timeout: 10000,
    validateStatus: () => true // Don't throw on any status code
  });

  span.setAttribute('response.status', response.status);
  span.setAttribute('response.statusText', response.statusText);

  // Handle HTTP errors
  if (response.status === 404) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.type', 'artist_not_found');
    span.addEvent('Artist not found on Last.fm');
    return { success: false, error: 'artist_not_found', status: response.status };
  }

  if (response.status >= 400) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.type', 'last_fm_error');
    span.setAttribute('error.status', response.status);
    span.addEvent('Error response from Last.fm');
    return { success: false, error: 'last_fm_error', status: response.status };
  }

  return { success: true, data: response.data };
}
function parseArtistData(html, span) {
  const $ = cheerio.load(html);
  const artistTitle = $('h1.header-new-title').text().trim();
  span.setAttribute('artist.title', artistTitle);

  const { videos, artistPath } = extractVideoData(html);
  span.setAttribute('artist.path', artistPath);
  span.setAttribute('videos.count', Object.keys(videos).length);

  return {
    title: artistTitle,
    url: `https://www.last.fm/music/${encodeURIComponent(artistTitle)}`,
    path: artistPath,
    videos
  };
}

async function crawlArtist(artistName) {
  const tracer = trace.getTracer('music-crawler');
  const span = tracer.startSpan('crawl_artist');
  span.setAttribute('artist.name', artistName);
  try {
    const fetchResult = await fetchLastFmData(artistName, span);
    if (!fetchResult.success) {
      return fetchResult; // Return error result
    }
    const artistData = parseArtistData(fetchResult.data, span)
    return {
      success: true,
      artist: {
        name: artistName,
        ...artistData
      }
    };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.type', error.name || 'unknown');
    span.setAttribute('error.message', error.message || 'Unknown error');
    return { success: false, error: 'unexpected_error', message: error.message };
  } finally {
    span.end();
  }

}

function extractVideoData(html) {
  const $ = cheerio.load(html);
  const videos = {};
  let artistPath = '';

  // Target the same selector: td.chartlist-play > a
  $('td.chartlist-play > a').each((i, element) => {
    const videoName = $(element).attr('data-track-name');
    const videoUrl = $(element).attr('href');
    const path = $(element).attr('data-artist-url');

    if (path && !artistPath) {
      artistPath = path; // Store the artist path from the first match
    }

    if (videoUrl && videoName) {
      videos[videoUrl] = videoName;
    }
  });

  return { videos, artistPath };
}
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
