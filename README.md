# Open Flix

Open Flix is a self-hosted, personal media dashboard designed to track movies and TV shows you want to watch. With a modern, "Netflix-style" interface, it allows you to organize your watchlist, track your viewing progress down to the episode level, and manage streaming links—all in one place.

## Features

- **Modern UI:** A sleek, dark-themed interface with "glassmorphism" design elements, providing a premium user experience.
- **Responsive Design:** Fully optimized for both desktop and mobile devices.
- **Smart Library Management:**
  - **Movies & TV Shows:** Separate tabs for organizing different media types.
  - **Easy Addition:** simply paste an IMDB URL, and Open Flix automatically scrapes metadata (poster, rating, cast, description, etc.).
  - **Tagging System:** Organize content with custom, drag-and-drop sortable tags.
- **Progress Tracking:**
  - Mark movies as watched.
  - Track TV shows by season or individual episodes.
- **Streaming Links:** Save and manage direct links to where your content is available (Netflix, Prime, Plex, etc.).
- **Detailed Info:** View cast lists, IMDB ratings, genres, and full episode guides.

## Technology Stack

Open Flix is built as a full-stack monorepo containerized with Docker.

- **Frontend:** React (TypeScript), built with Vite.
- **Backend:** Node.js with Express.
- **Scraping:** Cheerio (for fetching IMDB data).
- **Database:** PostgreSQL.
- **Containerization:** Docker & Docker Compose.

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose installed on your machine.

### Installation & Running

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/open-flix.git
    cd open-flix
    ```

2.  Start the application:
    ```bash
    docker-compose up -d --build
    ```
    *The `--build` flag ensures the latest images are built. The `-d` flag runs the containers in the background.*

3.  Access the dashboard:
    Open your browser and navigate to **http://localhost:8080**.

4.  **View Logs (Optional):**
    To see backend logs or debug issues:
    ```bash
    docker-compose logs -f backend
    ```

## Usage

1.  **Add Media:** Click the "Add Media" button and paste an IMDB link (e.g., `https://www.imdb.com/title/tt0111161/`).
2.  **Manage Tags:** Click "Manage Tags" to create custom categories.
3.  **Track Progress:** Click on any poster to open the detail view. Use the checkboxes to mark episodes or seasons as watched.
