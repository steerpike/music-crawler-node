CREATE TABLE Artists (
    ID INTEGER PRIMARY KEY,
    Name TEXT,
    Url TEXT UNIQUE,
    Path TEXT UNIQUE,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    LastCrawled DATETIME
);

CREATE TABLE Artist_Aliases (
    ID INTEGER PRIMARY KEY,
    AliasName TEXT NOT NULL,
    CanonicalArtistUrl TEXT NOT NULL,
    Source TEXT,           -- Where this alias came from (user input, last.fm, etc.)
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(CanonicalArtistUrl) REFERENCES Artists(Url),
    UNIQUE(AliasName, CanonicalArtistUrl)
);

-- Index for fast lookups by alias name
CREATE INDEX idx_artist_aliases_name ON Artist_Aliases(AliasName);

CREATE TABLE Tags (
    ID INTEGER PRIMARY KEY,
    Name TEXT UNIQUE
);

CREATE TABLE Videos (
    ID INTEGER PRIMARY KEY,
    Name TEXT,
    Url TEXT UNIQUE
);

CREATE TABLE Artist_Tags (
    ArtistUrl TEXT,
    TagName TEXT,
    FOREIGN KEY(ArtistUrl) REFERENCES Artists(Url),
    FOREIGN KEY(TagName) REFERENCES Tags(Name),
    UNIQUE(ArtistUrl, TagName)
);

CREATE TABLE Artist_Videos (
    ArtistUrl TEXT,
    VideoUrl TEXT,
    FOREIGN KEY(ArtistUrl) REFERENCES Artists(Url),
    FOREIGN KEY(VideoUrl) REFERENCES Videos(Url),
    UNIQUE(ArtistUrl, VideoUrl)
);

CREATE TABLE Similar_Artists (
    ArtistUrl TEXT,
    RelatedArtistUrl TEXT,
    FOREIGN KEY(ArtistUrl) REFERENCES Artists(Url),
    FOREIGN KEY(RelatedArtistUrl) REFERENCES Artists(Url),
    UNIQUE(ArtistUrl, RelatedArtistUrl)
);

-- Queue table for tracking artists to be crawled
CREATE TABLE Crawl_Queue (
    ID INTEGER PRIMARY KEY,
    ArtistName TEXT NOT NULL,
    SourceArtistUrl TEXT,  -- The artist that led to this discovery
    Status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'error'
    AttemptCount INTEGER DEFAULT 0, -- Track retry attempts
    ErrorMessage TEXT,             -- Store last error if any
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(SourceArtistUrl) REFERENCES Artists(Url),
    UNIQUE(ArtistName, SourceArtistUrl)  -- Prevent duplicate entries
);

-- Index for efficient queue processing
CREATE INDEX idx_crawl_queue_status ON Crawl_Queue(Status);

-- Index for tracking source relationships
CREATE INDEX idx_crawl_queue_source ON Crawl_Queue(SourceArtistUrl);
