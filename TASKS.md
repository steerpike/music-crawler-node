# TASKS.md: Node.js to Elixir Migration

## High-Level Task Outline

### Phase 1: Foundation Setup (With Built-in Observability)

- [ ] 1.1 Create Phoenix project structure
- [ ] 1.2 Configure OpenTelemetry from day one
- [ ] 1.3 Setup database with Ecto and SQLite
- [ ] 1.4 Create basic health check endpoint with tracing
- [ ] 1.5 Setup development environment with telemetry dashboard

### Phase 2: Core Data Layer

- [ ] 2.1 Create Ecto schemas with telemetry
- [ ] 2.2 Implement Artists context with spans
- [ ] 2.3 Create database migration scripts
- [ ] 2.4 Add database operation telemetry
- [ ] 2.5 Test data layer with observability validation

### Phase 3: External API Integrations (Last.fm)

- [ ] 3.1 Create Last.fm scraping service with telemetry
- [ ] 3.2 Implement HTML parsing (Floki equivalent to cheerio)
- [ ] 3.3 Add error tracking and retry logic with spans
- [ ] 3.4 Create artist data extraction with attributes
- [ ] 3.5 Test Last.fm integration with trace validation

### Phase 4: Music-Map Integration

- [ ] 4.1 Create Music-Map scraping service with telemetry
- [ ] 4.2 Implement related artist discovery algorithm
- [ ] 4.3 Add strength calculation and ranking with spans
- [ ] 4.4 Create bidirectional relationship storage
- [ ] 4.5 Test music-map integration with observability

### Phase 5: Background Processing System

- [ ] 5.1 Setup Oban with telemetry
- [ ] 5.2 Create crawl queue worker with spans
- [ ] 5.3 Implement queue management with metrics
- [ ] 5.4 Add retry and error handling with tracing
- [ ] 5.5 Test background processing with queue telemetry

### Phase 6: Artist Network Logic

- [ ] 6.1 Port balanced video selection algorithm
- [ ] 6.2 Implement artist weighting with telemetry
- [ ] 6.3 Create diversity optimization with metrics
- [ ] 6.4 Add selection performance tracking
- [ ] 6.5 Test network algorithms with observability

### Phase 7: Authentication & OAuth

- [ ] 7.1 Setup Ueberauth with Google OAuth
- [ ] 7.2 Implement session management with tracing
- [ ] 7.3 Add authentication middleware with spans
- [ ] 7.4 Create user management with telemetry
- [ ] 7.5 Test auth flow with security observability

### Phase 8: YouTube API Integration

- [ ] 8.1 Create YouTube client with telemetry
- [ ] 8.2 Implement playlist creation with spans
- [ ] 8.3 Add video addition logic with metrics
- [ ] 8.4 Create batch processing with rate limit tracking
- [ ] 8.5 Test YouTube integration with API telemetry

### Phase 9: Web API Layer

- [ ] 9.1 Create artist lookup endpoints with tracing
- [ ] 9.2 Implement playlist creation endpoints
- [ ] 9.3 Add queue management endpoints
- [ ] 9.4 Create random video selection endpoints
- [ ] 9.5 Test all endpoints with request telemetry

### Phase 10: Performance & Monitoring

- [ ] 10.1 Add custom metrics and dashboards
- [ ] 10.2 Implement performance benchmarking
- [ ] 10.3 Create alerting and monitoring
- [ ] 10.4 Add logging and error tracking
- [ ] 10.5 Performance validation against Node.js version

### Phase 11: Testing & Validation

- [ ] 11.1 Create comprehensive test suite
- [ ] 11.2 Add integration tests with telemetry
- [ ] 11.3 Performance testing with observability
- [ ] 11.4 End-to-end workflow validation
- [ ] 11.5 Production readiness checklist

### Phase 12: Deployment & Migration

- [ ] 12.1 Create deployment configuration
- [ ] 12.2 Setup production observability
- [ ] 12.3 Data migration scripts
- [ ] 12.4 Blue-green deployment strategy
- [ ] 12.5 Rollback procedures with monitoring

## Key Missing Components from Initial Analysis

### Music-Map Integration Details

The original analysis missed the critical music-map.com integration that:

- Fetches related artists from music-map.com
- Parses HTML to extract artist relationships
- Calculates strength values based on position
- Skips the original artist (first in list)
- Stores bidirectional relationships

### Observability-First Approach

Each task includes telemetry requirements:

- OpenTelemetry spans for all operations
- Custom metrics for business logic
- Error tracking and alerting
- Performance monitoring
- Request tracing end-to-end

## Next Steps

This outline will be expanded task by task with:

- Detailed implementation steps
- Code examples and patterns
- Telemetry requirements
- Testing criteria
- Success metrics

Each phase can be completed independently while maintaining observability throughout the development process.

## AI Agent Reference Strategy

### How to Structure the Migration for AI Development

#### 1. Reference File Mapping
Create a mapping document that links Node.js files to their Elixir equivalents:

```
Node.js -> Elixir Mapping:
├── index.js -> lib/music_crawler_web/router.ex + controllers/
├── artist-network.js -> lib/music_crawler/artist_network.ex
├── musicmap.js -> lib/music_crawler/crawling/musicmap_crawler.ex
├── youtube.js -> lib/music_crawler/youtube/client.ex
├── db.js -> lib/music_crawler/artists.ex (context)
├── tracing.js -> lib/music_crawler/telemetry.ex
└── schema.sql -> priv/repo/migrations/
```

#### 2. Feature Equivalence Checklist
For each Node.js function/feature, create an Elixir equivalent with the same:
- Input parameters
- Return values/structure
- Error handling patterns
- Telemetry attributes
- Side effects

#### 3. API Compatibility Requirements
Maintain exact API compatibility by:
- Preserving all HTTP endpoints and their signatures
- Matching response JSON structures exactly
- Maintaining same error response formats
- Keeping same query parameter names and defaults

#### 4. Observability Parity
Ensure Elixir telemetry matches Node.js exactly:
- Same span names and attributes
- Identical custom metrics
- Matching error categorization
- Same performance measurement points

#### 5. Development Workflow
1. **Read existing Node.js implementation first**
2. **Identify core logic and patterns**
3. **Create Elixir equivalent with same behavior**
4. **Add comprehensive tests comparing outputs**
5. **Validate telemetry matches original**
6. **Document any behavioral differences**

#### 6. Testing Strategy for Equivalence
- **Input/Output Testing**: Same inputs should produce same outputs
- **API Contract Testing**: HTTP responses must be identical
- **Performance Benchmarking**: Compare against Node.js baseline
- **Telemetry Validation**: Trace structures should match
- **Error Behavior Testing**: Same error conditions produce same responses
