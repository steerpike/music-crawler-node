const sqlite3 = require('sqlite3').verbose();
const { trace, SpanStatusCode } = require('@opentelemetry/api');

// Create a database connection
const db = new sqlite3.Database('./music.db', (err) => {
  if (err) {
    console.error('Error opening database ' + err.message);
  } else {
    console.log('Connected to the music database.');
  }
});

// Artist operations
const artistsDb = {
  /**
   * Get artist by name
   * @param {string} name - Artist name to search for
   * @returns {Promise<object|null>} Artist object or null if not found
   */
  getByName: (name) => {
    return new Promise((resolve, reject) => {
      const tracer = trace.getTracer('music-crawler-db');
      const span = tracer.startSpan('db.getArtistByName');
      span.setAttribute('artist.name', name);

      const sql = 'SELECT * FROM Artists WHERE Name = ?';
      db.get(sql, [name], (err, row) => {
        if (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
          reject(err);
        } else {
          span.setAttribute('artist.found', !!row);
          span.end();
          resolve(row || null);
        }
      });
    });
  },

  /**
   * Save artist data to the database
   * @param {object} artist - Artist object with name, title, and path
   * @returns {Promise<object>} Result with success status
   */
  save: (artist) => {
    return new Promise((resolve, reject) => {
      const tracer = trace.getTracer('music-crawler-db');
      const span = tracer.startSpan('db.saveArtist');
      span.setAttribute('artist.name', artist.name);
      span.setAttribute('artist.title', artist.title || '');

      const url = `/music/${encodeURIComponent(artist.name)}`;
      const sql = `
        INSERT OR REPLACE INTO Artists (Name, Url, Path, LastCrawled)
        VALUES (?, ?, ?, datetime('now'))
      `;

      db.run(sql, [artist.name, url, artist.path], function(err) {
        if (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
          reject(err);
        } else {
          span.setAttribute('db.changes', this.changes);
          span.setAttribute('db.lastId', this.lastID);
          span.end();
          resolve({
            success: true,
            id: this.lastID,
            changes: this.changes
          });
        }
      });
    });
  },

  /**
   * Find artist by name with alias support
   * @param {string} name - Artist name to search for
   * @returns {Promise<object|null>} Artist object or null if not found
   */
  findByNameWithAliases: (name) => {
    return new Promise((resolve, reject) => {
      const tracer = trace.getTracer('music-crawler-db');
      const span = tracer.startSpan('db.findArtistByNameWithAliases');
      span.setAttribute('artist.search_name', name);

      // First try to find the artist via aliases
      const sql = `
        SELECT a.* FROM Artists a
        LEFT JOIN Artist_Aliases aa ON a.Url = aa.CanonicalArtistUrl
        WHERE a.Name = ? COLLATE NOCASE OR aa.AliasName = ? COLLATE NOCASE
        LIMIT 1
      `;

      db.get(sql, [name, name], (err, row) => {
        if (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
          reject(err);
        } else {
          span.setAttribute('artist.found', !!row);
          span.end();
          resolve(row || null);
        }
      });
    });
  }
};

// Export the database and operations
module.exports = {
  db,
  artists: artistsDb,
  // You can add more collections like videos, tags, etc. as needed
};
