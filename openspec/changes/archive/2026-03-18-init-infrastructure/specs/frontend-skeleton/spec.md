## ADDED Requirements

### Requirement: Next.js App Router
The Admin Dashboard application SHALL be built using Next.js with the App Router architecture.

#### Scenario: Landing page access
- **WHEN** navigating to the root URL of the admin app
- **THEN** the dashboard skeleton is displayed with a sidebar and header

### Requirement: Design System Integration
The frontend SHALL integrate Tailwind CSS and `shadcn/ui` for a consistent and premium design language.

#### Scenario: UI component rendering
- **WHEN** a shadcn component is used in a page
- **THEN** it renders with the correct tokens and styles defined in the design system
