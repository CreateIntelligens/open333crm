import { prisma } from '@open333crm/database';
import { EventBus, BaseEvent } from '../event-bus/event-bus';
import { logger } from '../logger';

export class AutomationEngine {
  static init() {
    EventBus.subscribe(async (event) => {
      await this.evaluate(event);
    });
    logger.info('Automation Engine initialized and listening to Event Bus');
  }

  static async evaluate(event: BaseEvent) {
    try {
      // 1. Fetch active rules for this tenant and trigger type
      const rules = await prisma.automationRule.findMany({
        where: {
          tenantId: event.tenantId,
          isActive: true,
          // In a real system, we'd parse the trigger JSON to filter by type
        },
      });

      for (const rule of rules) {
        const trigger = rule.trigger as any;
        if (trigger.type !== event.type) continue;

        // 2. Evaluate conditions (simplistic mock for now)
        // In a real system, we'd use a rule engine like json-rules-engine
        const conditionsMatch = true; // Placeholder

        if (conditionsMatch) {
          logger.info(`Executing rule "${rule.name}" for event ${event.type}`);
          await this.executeActions(rule, event);
          
          // Update last run stats
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: {
              runCount: { increment: 1 },
              lastRunAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      logger.error('Automation evaluation error:', err);
    }
  }

  private static async executeActions(rule: any, event: BaseEvent) {
    const actions = rule.actions as any[];
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'add_tag':
            // await ContactService.addTag(event.payload.contactId, action.params.tagId);
            break;
          case 'send_message':
            // Logic to send message via channel plugin
            break;
          case 'create_case':
            // await CaseService.create({ ... });
            break;
          default:
            logger.warn(`Unknown action type: ${action.type}`);
        }
      } catch (err) {
        logger.error(`Action execution failed for rule ${rule.id}:`, err);
      }
    }
  }
}
