import { EventBus, BaseEvent } from "@open333crm/core";
import { handleAutomationEvent } from "@open333crm/automation";

let subscriber: ReturnType<typeof EventBus.subscribe> | null = null;

const AUTOMATION_EVENTS = [
  "message.received",
  "case.created",
  "case.status_changed",
  "contact.created",
];

/**
 * Start the automation event listener.
 * Subscribes to the core EventBus and dispatches matching events
 * to the automation engine.
 */
export function startAutomationListener() {
  if (subscriber) {
    return; // Already running
  }

  subscriber = EventBus.subscribe(async (event: BaseEvent) => {
    if (!AUTOMATION_EVENTS.includes(event.type)) {
      return;
    }

    try {
      const result = await handleAutomationEvent(
        event.type,
        event.payload,
        event.tenantId,
      );

      if (result.executed) {
        console.log(
          `[Automation] Dispatched ${event.type} for tenant ${event.tenantId}: ` +
            `${result.matchedRules?.length || 0} rules matched, ` +
            `${result.actionsExecuted || 0} actions executed`,
        );
      }
    } catch (err) {
      console.error(`[Automation] Failed to handle event ${event.type}:`, err);
    }
  });

  console.log(
    `[Automation] Listener started, watching: ${AUTOMATION_EVENTS.join(", ")}`,
  );
}

/**
 * Stop the automation event listener.
 */
export function stopAutomationListener() {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
    console.log("[Automation] Listener stopped");
  }
}
