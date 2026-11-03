## MODIFIED Requirements

### Requirement: socket:emit Message Shape
Each message on the `socket:emit` Redis channel SHALL be JSON with the shape:

```ts
{
  room?: string;    // one Socket.IO room name, e.g. "conversation:42" or "user:7"
  rooms?: string[]; // several room names; the API emits once to all of them
  event: string;    // Socket.IO event name, e.g. "notification:new"
  data: unknown;    // Arbitrary serializable payload
}
```

A message SHALL give `room`, or `rooms` as a non-empty array of strings. When a message gives `rooms`, the API SHALL emit the event once to all the rooms, so that a connection in more than one of the rooms receives the event once. A worker SHALL send an event that carries the messages or the conversation data of a channel (`message.new`, `conversation.updated`, and `automation.executed` for an event with a channel) to the channel rooms (`tenant:<tenantId>:channel:<channelId>` and `tenant:<tenantId>:channels:all`), and SHALL NOT send it to `tenant:<tenantId>`.

#### Scenario: Malformed message received on socket:emit channel
- **WHEN** the API's Redis subscriber receives a message on `socket:emit` that cannot be parsed as JSON, has no `event`, or has neither a string `room` nor a non-empty string array `rooms`
- **THEN** the API logs a warning with the raw message content and discards it without calling `io.emit`

#### Scenario: Worker sends a channel event to several rooms
- **WHEN** a worker writes a system message to a conversation of channel C and publishes `message.new` with `rooms` set to the conversation room and the two channel rooms of C
- **THEN** the API emits `message.new` once to these rooms; a member who cannot see channel C does not receive it
