const axios = require('axios');
const cheerio = require('cheerio');
const { trace, SpanStatusCode } = require('@opentelemetry/api');

/**
 * Fetches related artists from music-map.com
 * @param {string} artistName - Name of the artist to find related artists for
 * @param {object} parentSpan - Optional parent span for tracing
 * @returns {Promise<object>} Result containing related artists or error information
 */
async function fetchRelatedArtists(artistName, parentSpan = null) {
  const tracer = trace.getTracer('music-crawler');
  const spanOptions = parentSpan ? { parent: parentSpan } : undefined;
  const span = tracer.startSpan('musicmap.fetch_related', spanOptions);

  span.setAttribute('artist.name', artistName);

  try {
    const encodedArtistName = encodeURIComponent(artistName);
    const url = `https://www.music-map.com/${encodedArtistName}`;
    span.setAttribute('request.url', url);

    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true // Don't throw on any status code
    });

    span.setAttribute('response.status', response.status);

    if (response.status === 404 || response.status >= 400) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute('error.type', 'fetch_failed');
      span.setAttribute('error.status', response.status);
      span.end();

      return {
        success: false,
        error: 'music_map_error',
        status: response.status
      };
    }

    const relatedArtists = parseRelatedArtists(response.data);
    span.setAttribute('related_artists.count', relatedArtists.length);
    span.end();

    return {
      success: true,
      artistName,
      relatedArtists
    };
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute('error.type', error.name || 'unknown');
    span.setAttribute('error.message', error.message || 'Unknown error');
    span.end();

    return {
      success: false,
      error: 'unexpected_error',
      message: error.message
    };
  }
}

/**
 * Parse HTML from music-map to extract related artists
 * @param {string} html - HTML content from music-map.com
 * @returns {Array<object>} List of related artists with names and strength values
 */
function parseRelatedArtists(html) {
  const $ = cheerio.load(html);
  const relatedArtists = [];

  // Music-map places artists in a specific structure
  $('#gnodMap a').each((index, element) => {
    const artistName = $(element).text().trim();
    if (index > 0 && artistName) {
      // Calculate a strength value between 0.1 and 1.0
      // First artist gets 1.0, last gets 0.1
      const strength = Math.max(0.1, 1 - (index / Math.max(1, 48 - 1) * 0.9));
      relatedArtists.push({
        name: artistName,
        // Calculate proximity/strength based on position if needed
        strength: parseFloat(strength.toFixed(2)) // Limit to 2 decimal places
      });
    }
  });

  console.log('Found related artists:', relatedArtists.length);
  return relatedArtists;
}

module.exports = {
  fetchRelatedArtists
};
