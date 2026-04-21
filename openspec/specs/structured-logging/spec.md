### Requirement: Configurable log transport via environment variables
The logger SHALL read `LOG_TRANSPORT`, `LOG_DIR`, and `LOG_MAX_FILES` from the environment at startup to determine where logs are written.

#### Scenario: Default transport is console
- **WHEN** `LOG_TRANSPORT` is not set
- **THEN** the logger outputs to stdout only using colorized simple format

#### Scenario: File-only transport
- **WHEN** `LOG_TRANSPORT=file`
- **THEN** the logger writes to `{LOG_DIR}/app-YYYY-MM-DD.log` in JSON format and does NOT write to stdout

#### Scenario: Both transports
- **WHEN** `LOG_TRANSPORT=both`
- **THEN** the logger writes to stdout (colorized simple) AND to `{LOG_DIR}/app-YYYY-MM-DD.log` (JSON) simultaneously

#### Scenario: Console transport explicit
- **WHEN** `LOG_TRANSPORT=console`
- **THEN** the logger outputs to stdout only, same as default

### Requirement: Daily log rotation with compression
When the file transport is active, the logger SHALL rotate log files daily and compress old files.

#### Scenario: Daily rotation
- **WHEN** midnight passes
- **THEN** the current log file is closed and a new file `app-YYYY-MM-DD.log` is opened for the new day

#### Scenario: Old files compressed
- **WHEN** a log file is rotated
- **THEN** the old file is compressed to `.gz` format

#### Scenario: File retention limit
- **WHEN** `LOG_MAX_FILES` is set (e.g. `14d`)
- **THEN** log files older than the specified period are automatically deleted

### Requirement: All backend console.* calls replaced with logger
Every `console.log`, `console.warn`, `console.error`, `console.debug`, and `console.info` call in `apps/api`, `apps/workers`, `packages/channel-plugins`, `packages/brain`, and `packages/automation` SHALL be replaced with the equivalent `logger.*` call from `@open333crm/core`.

#### Scenario: console.log replaced
- **WHEN** code previously called `console.log(msg)`
- **THEN** it now calls `logger.info(msg)` or `logger.debug(msg)` as appropriate

#### Scenario: console.error replaced
- **WHEN** code previously called `console.error(msg, err)`
- **THEN** it now calls `logger.error(msg, { error: String(err) })` or `logger.error(msg, err)`

#### Scenario: Frontend console unchanged
- **WHEN** code is in `apps/web` or `apps/widget`
- **THEN** `console.*` calls are NOT modified (browser environment)
