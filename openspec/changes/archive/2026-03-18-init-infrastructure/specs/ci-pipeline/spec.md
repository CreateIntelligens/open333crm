## ADDED Requirements

### Requirement: Lint and Build check
The CI pipeline SHALL automatically run linting and build checks on every pull request to ensuring code quality and build integrity.

#### Scenario: Successful CI run
- **WHEN** a new commit is pushed to a PR
- **THEN** GitHub Actions executes `lint` and `build` tasks and reports success if both pass
