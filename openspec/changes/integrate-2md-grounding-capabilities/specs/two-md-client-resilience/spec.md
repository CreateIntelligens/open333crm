## Purpose

Provides resilient, high-concurrency client infrastructure for 2md upstream services with single-flight request coalescing, short-lived caching, node health tracking, and circuit-breaker failover to eliminate thundering herd problems across TWO_MD_BASE_URLS.

## ADDED Requirements

### Requirement: Single-Flight Request Coalescing
The system SHALL coalesce concurrent in-flight requests that share an identical normalized target key into a single pending execution promise so that only one upstream HTTP request is dispatched.

#### Scenario: Concurrent identical page read requests
- **WHEN** multiple concurrent requests attempt to read the same target URL before the first request finishes
- **THEN** only one network request is sent to the upstream service
- **AND** all callers await and receive the same parsed result or error

#### Scenario: Concurrent identical search queries
- **WHEN** multiple concurrent requests trigger `search_web` with the same trimmed query string
- **THEN** only one search request is dispatched upstream, and all callers receive the shared results

### Requirement: Short-Lived In-Memory Response Caching
The system SHALL cache successful upstream responses in memory with bounded TTL (60 seconds for web searches and page reads; 10 minutes for content-hashed images and documents) to prevent burst re-querying.

#### Scenario: Repeated query within TTL
- **WHEN** a request arrives with a key that exists in the valid cache
- **THEN** the system returns the cached response immediately without calling upstream services

#### Scenario: Cache entry expiration
- **WHEN** a request arrives after the TTL of a cached response has expired
- **THEN** the system executes a fresh upstream fetch and refreshes the cache entry

### Requirement: Circuit Breaker and Node Health State
The system SHALL track health status for each endpoint in `TWO_MD_BASE_URLS`. When consecutive failures or timeouts exceed the failure threshold, the node SHALL enter a cooldown (OPEN) state and subsequent requests SHALL bypass it immediately without incurring timeout latency.

#### Scenario: Unhealthy primary node bypass
- **WHEN** the primary node has failed consecutively past the failure threshold (e.g. 3 times)
- **THEN** incoming requests immediately route to the next healthy node in the fallback list without waiting for the primary node's timeout
- **AND** the primary node enters a cooldown period before allowing a single probe request (HALF-OPEN)

#### Scenario: Node health recovery
- **WHEN** a probe request to a cooling node succeeds
- **THEN** the node is restored to healthy (CLOSED) status and resumes standard priority

### Requirement: Jittered Retry and Anti-Cascading Failover
The system SHALL introduce randomized jittered delays between failover attempts to prevent synchronized request waves from overwhelming secondary and tertiary backup nodes simultaneously.

#### Scenario: Cascade mitigation during primary outage
- **WHEN** the primary node fails and multiple concurrent requests transition to the secondary node
- **THEN** failover transitions apply randomized jitter (e.g. 20-100ms) to desynchronize upstream arrival bursts
