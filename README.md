# Music Crawler

A Node.js application that builds a network of related musical artists, collects their videos, and creates YouTube playlists with content from both the requested artist and similar artists.

## Features

* Creates customized YouTube playlists based on artist networks
* Discovers related artists through a graph-based approach
* Optimizes video selection for artist diversity
* Provides comprehensive observability through OpenTelemetry tracing
* OAuth integration with Google for YouTube API access
* Background crawling to continuously expand the artist database

## Getting Started

### Prerequisites

* Node.js 16.x or higher
* SQLite3
* A Google Developer account for OAuth credentials

### Installation

1. Clone the repository:

   **git clone **https://github.com/yourusername/music-crawler-node.git

   **cd music-crawler-node**
2. Install dependencies:

   **npm install**
3. Set up the database:

   **cat schema.sql | sqlite3 music.db**
4. Configure environment variables: Create a [.env](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html) file in the project root with the following:

   **PORT=3000**

   **SESSION_SECRET=your_secure_session_secret**

   **GOOGLE_CLIENT_ID=your_google_client_id**

   **GOOGLE_CLIENT_SECRET=your_google_client_secret**

### Running the Application

Start the server:

**`npm start`**

The server will be available at [http://localhost:3000](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html)

## API Endpoints

### Authentication

* `GET /auth/google`: Authenticate with Google OAuth
* `GET /auth/google/callback`: OAuth callback
* `GET /profile`: View authenticated user profile
* `GET /logout`: Log out the current user

### Artist Data

* `GET /artist/:name`: Get artist information
* `GET /query/:name/random-videos`: Get a selection of videos from an artist and their related artists
  * Query params: [maxRelated](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html) (default: 5), [count](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html) (default: 20)

### Playlist Management

* `GET /playlist/:name`: Create a YouTube playlist with videos from an artist network
  * Query params: [maxRelated](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html) (default: 5), [count](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html) (default: 20)
  * Requires authentication

### System Management

* `GET /process-queue`: Process the next batch of artists in the crawl queue

## Architecture

* **Express.js** : Web framework
* **SQLite** : Database for storing artist and video information
* **Passport.js** : Authentication with Google OAuth
* **OpenTelemetry** : Observability with distributed tracing
* **Cheerio** : HTML parsing for web scraping

## Observability

The application uses OpenTelemetry for comprehensive tracing. Send traces to your preferred backend (Honeycomb, Jaeger, etc.) by configuring the OTLPTraceExporter in [tracing.js](vscode-file://vscode-app/Applications/Visual%20Studio%20Code.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html).

## Development

For development mode with auto-reloading:

```
npm start
```
