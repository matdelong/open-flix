# Open Flix - Project Context

## Project Goal

The primary goal is to create "Open Flix," a self-hosted web application with a user interface inspired by Netflix. It serves as a personal dashboard for tracking movies and TV shows the user intends to watch, organizing content across various streaming platforms.

## Technology Stack

This is a full-stack monorepo, containerized with Docker.

*   **Frontend:** React with TypeScript, built using Vite.
*   **Backend:** Node.js with Express, using `axios` and `cheerio` for web scraping.
*   **Database:** PostgreSQL.
*   **Orchestration:** Docker Compose.

## Project Structure

*   `/`: The project root contains the `docker-compose.yml` file and this context file.
*   `/frontend`: Contains the React application. Key components include `MediaCard`, `MediaDetail`, `MediaRow`, `TagsModal`, `StreamingLinksModal`, and `SignIn`.
*   `/backend`: Contains the Node.js/Express application with API routes for media, tags, and streaming links.
*   `postgres_data`: A Docker volume used for persisting PostgreSQL data.

## Current Status & Key Features

The application is a functional, feature-rich dashboard with a modern, responsive UI and secure access control.

### Authentication & Security:
*   **PIN Protection:** The application is protected by a PIN code (configured via `WEB_PIN` environment variable).
*   **Persistent Login:** Users remain logged in for 10 years via a secure, HTTP-only cookie containing the base64-encoded PIN.
*   **Unauthorized Access Handling:** Attempts to access protected API routes without a valid token result in a 401 Unauthorized response, automatically logging the user out.

### Backend Capabilities:
*   **Advanced Web Scraper:**
    *   `POST /api/media` accepts an IMDB URL and media type (`movie` or `tv_show`).
    *   Scrapes metadata (Title, Year, Poster, Description, Rating, Genres, Actors) by parsing embedded JSON-LD data from IMDB.
    *   Automatically fetches full Season and Episode lists for TV shows.
*   **Data Management:**
    *   Endpoints for CRUD operations on Media, Tags, and Streaming Links.
    *   `GET /api/media/grouped` returns content organized by category ("New Releases", Genre) for the main view.
*   **Tracking:**
    *   Granular "watched" status tracking for Movies, Seasons, and individual Episodes.

### Frontend Features:
*   **Modern UI:**
    *   A "glassmorphism" design aesthetic with translucent modals, rounded corners, and blur effects.
    *   Fully responsive layout optimized for mobile devices (hamburger-style stacking on small screens).
*   **Dashboard View:**
    *   Horizontally scrolling category rows.
    *   Tabs for switching between "Movies" and "TV Shows".
*   **Detailed Media View:**
    *   Full-page overlay displaying comprehensive media info.
    *   Manage "watched" status for episodes/seasons with checkboxes.
    *   Add/remove custom tags.
    *   Manage direct streaming links to external platforms.
*   **Tag Management:**
    *   A drag-and-drop interface for reordering tags.
    *   Compact, inline form for adding new tags.

## Recent Technical Updates

*   **Security Implementation:**
    *   Added `WEB_PIN` environment variable support in `docker-compose.yml`.
    *   Created `SignIn` component for PIN entry.
    *   Implemented backend middleware to verify `auth_token` cookie against the configured PIN.
*   **Mobile Optimizations:**
    *   Fixed `MediaDetail` close button styling on mobile (removed padding to ensure circular shape).
    *   Updated "Add Media" and "Manage Tags" button layout to display side-by-side on mobile screens.
    *   Reordered "Add" and "Cancel" buttons in the media modal for better mobile ergonomics.

## How to Run the Application

1.  Navigate to the project's root directory.
2.  Set your desired PIN in `docker-compose.yml` (default is `0270`).
3.  Run the command: `docker-compose up -d --build` (The `-d` flag runs it in the background).
4.  Access the web interface in your browser at: **http://localhost:8080**
5.  Enter the PIN to access the dashboard.

This command builds the images, starts all containers, and handles networking. Database readiness is managed via healthchecks.

## Deployment Notes (Raspberry Pi)

### Database Migration
To copy your local database to a running Raspberry Pi instance:
1.  **Local Machine:**
    ```bash
    # Create backup
    PGPASSWORD=password pg_dump -h localhost -U user -d openflix > backup.sql
    # Copy to Pi
    scp backup.sql pi@<PI_IP_ADDRESS>:/home/pi/
    ```
2.  **On Raspberry Pi:**
    ```bash
    # Clear existing schema (if conflicts exist)
    docker exec -it open-flix-db-1 psql -U user -d openflix -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    # Restore backup
    docker exec -i open-flix-db-1 psql -U user -d openflix < ../backup.sql
    ```

### Troubleshooting Docker on Older OS (Buster)
If Docker fails to start with `exit-code` on Raspbian Buster:
1.  Switch to legacy iptables:
    ```bash
    sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
    sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
    ```
2.  Configure Docker daemon (`/etc/docker/daemon.json`):
    ```json
    { "storage-driver": "overlay2" }
    ```
3.  Restart Docker: `sudo systemctl restart docker`

# Gemini Instructions

This document provides context and instructions for the Gemini AI assistant.

## Interaction Guidelines

When working on this project, please adhere to the following:

1.  **Context Awareness:** Always refer to this document (`GEMINI.md`) for the latest project status and architectural decisions.
2.  **Clarification:** If a request is ambiguous, ask specific questions to clarify requirements before proceeding.
3.  **Code Conventions:**
    - Follow the existing "glassmorphism" styling patterns in CSS.
    - Maintain the mobile-first responsive approach.
    - Ensure new features include proper error handling and loading states.
4.  **Verification:**
    - After making changes, verify that the application builds and runs correctly.
    - Check for unintended side effects, especially in responsive layouts.
5.  **Completion:** Notify the user when a task is complete and provide instructions for testing the changes.
