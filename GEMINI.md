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
*   `/frontend`: Contains the React application. Key components include `MediaCard`, `MediaDetail`, `MediaRow`, `TagsModal`, and `StreamingLinksModal`.
*   `/backend`: Contains the Node.js/Express application with API routes for media, tags, and streaming links.
*   `postgres_data`: A Docker volume used for persisting PostgreSQL data.

## Current Status & Key Features

The application is a functional, feature-rich dashboard with a modern, responsive UI.

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

*   **Responsive Design:**
    *   Implemented mobile-first CSS media queries (max-width: 768px).
    *   Adjusted layout to stack header elements and resize media cards for smaller screens.
    *   Ensured minimum touch target sizes (44px) for interactive elements.
*   **Layout Fixes:**
    *   Removed `display: flex` from `body` to resolve horizontal scrolling issues on narrow screens.
    *   Enforced global `box-sizing: border-box` and explicit width constraints on the root container.
*   **UX Improvements:**
    *   Modals now close with the `Escape` key and return focus appropriately.
    *   "Manage Tags" modal refactored for better information density and usability.

## How to Run the Application

1.  Navigate to the project's root directory.
2.  Run the command: `docker-compose up -d --build` (The `-d` flag runs it in the background).
3.  Access the web interface in your browser at: **http://localhost:8080**
4.  To see the container logs, run `docker-compose logs -f` or `docker-compose logs backend`.

This command builds the images, starts all containers, and handles networking. Database readiness is managed via healthchecks.

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
