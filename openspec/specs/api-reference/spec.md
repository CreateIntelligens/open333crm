# api-reference Specification

## Purpose

Provide one browsable, reproducible reference for the HTTP routes registered by the Open333CRM API and identify where protocol-specific documentation applies.

## Requirements

### Requirement: Complete HTTP route inventory

The API reference SHALL list each registered HTTP route with its method, full path, and API area. It SHALL distinguish routes whose request or response contract is not documented yet.

#### Scenario: Browse registered HTTP routes
- **WHEN** a maintainer opens the API reference
- **THEN** the reference shows every registered HTTP route with its method, full path, and API area

#### Scenario: Route is added or changed
- **WHEN** a route registration changes and the OpenAPI inventory is regenerated
- **THEN** the reference reflects the current method and full path

#### Scenario: Contract detail is unavailable
- **WHEN** an operation has no documented request or response schema
- **THEN** the reference identifies that contract detail as undocumented

### Requirement: Single API reference entry point

The web application SHALL provide a stable Redoc reference page and a Swagger UI console that render the same OpenAPI document.

#### Scenario: Open API reference
- **WHEN** a user opens the API reference page
- **THEN** Redoc renders the generated OpenAPI document

#### Scenario: OpenAPI document is unavailable
- **WHEN** the OpenAPI document cannot be loaded
- **THEN** the page shows a clear loading or error state

### Requirement: Protocol-specific interfaces stay identified

The API reference SHALL include the MCP HTTP transport endpoints and state that MCP JSON-RPC methods and Socket.IO events use separate protocol documentation.

#### Scenario: Review MCP transport and protocol scope
- **WHEN** a user reviews the API reference
- **THEN** the MCP HTTP transport endpoint is listed and the introduction points to separate MCP JSON-RPC documentation

#### Scenario: Review Socket.IO scope
- **WHEN** a user reviews the API reference introduction
- **THEN** the scope identifies Socket.IO events as a separate interface

### Requirement: Execute requests from the API reference

The Swagger UI console SHALL let users execute documented HTTP operations against the current origin, supply Bearer authorization, and inspect the response. Operations without authored request schemas SHALL provide a clearly identified generic JSON editor.

#### Scenario: Execute a same-origin request
- **WHEN** a user selects Try it out and executes an operation
- **THEN** Swagger UI sends the request to the current origin and displays the status, headers, and response body

#### Scenario: Execute a protected operation
- **WHEN** a user supplies a Bearer token through Swagger UI authorization and executes a protected operation
- **THEN** the request includes the Authorization header

#### Scenario: Execute an operation without an authored body schema
- **WHEN** an operation accepts a JSON body but has no documented body schema
- **THEN** Swagger UI provides an editable generic JSON body and identifies the contract as undocumented
