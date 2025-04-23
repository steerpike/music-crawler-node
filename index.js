require('dotenv').config();
require('./tracing.js');
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { db, artists } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const crawlQueue = new Map();

app.use(express.json());

app.get('/artist/:name', async (req, res) => {
  const artistName = req.params.name;

  try {
    // Try to get the artist from the database
    const artist = await artists.findByNameWithAliases(artistName);

    if (artist) {
      // Artist found, return it
      res.status(200).json(artist);
    } else {
      // Artist not found, trigger a crawl in the background
      res.status(404).json({
        error: 'Artist not found',
        message: 'We\'re fetching data for this artist. Try again soon.'
      });

      // Start a crawl if not already in progress
      if (!crawlQueue.has(artistName)) {
        crawlQueue.set(artistName, true);
        console.log(`Crawling artist: ${artistName}`);

        crawlArtist(artistName)
          .then(async (result) => {
            if (result.success) {
              console.log('Crawled artist data:', result.artist);

              // Save the artist data
              try {
                await artists.save(result.artist);
                console.log(`Saved artist: ${result.artist.name}`);
              } catch (saveError) {
                console.error(`Failed to save artist: ${saveError.message}`);
              }
            } else {
              console.error(`Failed to crawl artist ${artistName}: ${result.error}`);
            }
          })
          .finally(() => {
            crawlQueue.delete(artistName);
          });

        console.log(`Artist ${artistName} is not in the database. Starting crawl...`);
      }
    }
  } catch (error) {
    console.error('Error in /artist route:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
