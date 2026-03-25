## ADDED Requirements

### Requirement: Docker Compose setup
The project SHALL provide a `docker-compose.yml` file to spin up all necessary infrastructure services locally.

#### Scenario: Starting local services
- **WHEN** running `docker compose up -d`
- **THEN** PostgreSQL, Redis, and MinIO services are started and reachable on their defined ports

### Requirement: Persistence and Volumes
Local services SHALL use Docker volumes to ensure data persistence across container restarts.

#### Scenario: Data persistence after restart
- **WHEN** a service container is stopped and started
- **THEN** the data written before the stop is still present in the service
