require('dotenv').config();
require('./tracing.js');
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { artists, queue } = require('./db');
const musicmap = require('./musicmap');

const app = express();
const PORT = process.env.PORT || 3000;

const crawlQueue = new Map();

app.use(express.json());

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
          console.log(`Original artist`, item.SourceArtistUrl);
          console.log(`Related artist`, result.artist.url);
          artists.saveRelatedArtist(item.SourceArtistUrl, result.artist.url);
        }
        // Mark as completed
        await queue.updateStatus(item.ID, 'completed');
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
