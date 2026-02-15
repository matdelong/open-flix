# Open Flix - Project Context

## 1. Project Goal

The primary goal is to create "Open Flix," a web application with a user interface similar to Netflix. It is intended to be a personal dashboard for tracking movies and TV shows the user wants to watch across various streaming platforms.

## 2. Technology Stack

This is a full-stack monorepo, containerized with Docker.

*   **Frontend:** React with TypeScript, bootstrapped using Vite.
*   **Backend:** Node.js with Express, using `axios` and `cheerio` for web scraping.
*   **Database:** PostgreSQL.
*   **Orchestration:** Docker Compose.

## 3. Project Structure

*   `/`: The project root contains the `docker-compose.yml` file and this context file.
*   `/frontend`: Contains the React application, including a `components` directory for `MediaCard`, `MediaDetail`, and `MediaRow`.
*   `/backend`: Contains the Node.js/Express application.
*   `postgres_data`: A Docker volume used for persisting PostgreSQL data.

## 4. Current Status & Key Features

The application is a functional proof-of-concept with a robust backend and a dynamic frontend.

### Backend:
*   **Advanced Web Scraper:**
    *   A `POST /api/media` endpoint accepts an IMDB URL and media type (`movie` or `tv_show`).
    *   It scrapes IMDB by parsing an embedded JSON-LD data block, which is more reliable than CSS selectors.
    *   It automatically populates the database with: Title, Year, Poster URL, Description, Rating, Genres, and Actors.
    *   For TV shows, it performs a secondary scrape of the episodes page to get full Season and Episode lists.
*   **Data Endpoints:**
    *   `GET /api/media/grouped`: The primary endpoint for the main UI. It returns media pre-grouped by categories ("New Releases" and by Genre).
    *   `GET /api/media/:id`: Returns all detailed information for a single media item, including genres, actors, and full season/episode data for TV shows.
*   **"Mark as Watched" Endpoints:**
    *   `POST /api/media/:id/watched`
    *   `POST /api/seasons/:id/watched` (also marks all child episodes)
    *   `POST /api/episodes/:id/watched`

### Frontend:
*   **Netflix-style UI:**
    *   The main view is organized into horizontally-scrolling **category rows** (e.g., "New Releases", "Action").
    *   Tabs allow switching between "Movies" and "TV Shows".
    *   Media items are displayed as clickable `MediaCard` components.
*   **Detailed View:**
    *   Clicking a card opens a full-page `MediaDetail` overlay.
    *   This view displays the poster, description, rating, genres, cast, and a full, browsable episode list for TV shows.
*   **Add Media Workflow:**
    *   "Add Movie" and "Add TV Show" buttons open a modal to accept an IMDB URL.
    *   After adding an item, the UI automatically switches to the correct tab (Movies or TV Shows) to show the new content.
*   **"Mark as Watched" Interactivity:**
    *   The detail view contains buttons and checkboxes to toggle the `watched` status of movies, seasons, and episodes.
    *   The UI updates instantly and sends the change to the backend.

## 5. How to Run the Application

1.  Navigate to the project's root directory.
2.  Run the command: `docker-compose up -d --build` (The `-d` flag runs it in the background).
3.  Access the web interface in your browser at: **http://localhost:8080**
4.  To see the container logs, you can run `docker-compose logs -f` or `docker-compose logs backend`.

This command will build the images, start all containers, and handle the connections between them. The database readiness is managed by a healthcheck in the docker-compose file.
