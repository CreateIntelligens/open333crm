import { Engine } from 'json-rules-engine';
import { prisma } from '@open333crm/database';
import { EventBus, BaseEvent } from '../event-bus/event-bus';
import { logger } from '../logger';
import { ContactService } from '../contacts/contact-service';
import { CaseService } from '../cases/case-service';

export class AutomationEngine {
  static async start() {
    logger.info('[AutomationEngine] Subscribing to global EventBus...');
    
    EventBus.subscribe(async (event: BaseEvent) => {
      try {
        await this.handleEvent(event);
      } catch (err) {
        logger.error(`[AutomationEngine] Failed handling event ${event.type}:`, err);
      }
    });
  }

  private static async handleEvent(event: BaseEvent) {
    // 1. Fetch active rules for this tenant
    const rules = await prisma.automationRule.findMany({
      where: { tenantId: event.tenantId, isActive: true }
    });

    if (rules.length === 0) return;

    for (const rule of rules) {
      try {
        const trigger = rule.trigger as any;
        
        // 2. Check if trigger matches event type
        if (trigger?.type !== event.type && trigger?.type !== '*') continue;

        // 3. Initialize json-rules-engine
        const engine = new Engine();
        
        // Setup engine rule
        const engineRule = {
          conditions: rule.conditions as any,
          event: {
            type: 'match',
            params: rule.actions as any
          }
        };

        // If conditions is empty, json-rules-engine might fail or we can mock it
        if (!engineRule.conditions || Object.keys(engineRule.conditions).length === 0) {
          engineRule.conditions = { all: [] }; // Always passes
        }

        engine.addRule(engineRule as any);

        // 4. Run rules
        const { events } = await engine.run({ event: event.payload });

        // 5. If matched, execute actions
        if (events.length > 0) {
          logger.info(`[AutomationEngine] Rule ${rule.id} matched event ${event.type}. Executing actions...`);
          
          const actions = events[0].params as Array<{ type: string; params: any }>;
          let success = true;

          for (const action of actions || []) {
            try {
              await this.executeAction(event.tenantId, action, event);
            } catch (aErr) {
              logger.error(`[AutomationEngine] Action ${action.type} failed:`, aErr);
              success = false;
            }
          }

          // 6. Log execution
          await prisma.automationLog.create({
            data: {
              ruleId: rule.id,
              triggerRef: event.type,
              success
            }
          });

          // Update run count
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { 
              runCount: { increment: 1 },
              lastRunAt: new Date()
            }
          });
        }
      } catch (rErr) {
        logger.error(`[AutomationEngine] Error evaluating rule ${rule.id}:`, rErr);
      }
    }
  }

  private static async executeAction(tenantId: string, action: { type: string; params: any }, event: BaseEvent) {
    logger.debug(`[AutomationEngine] Executing action ${action.type}`, action.params);

    switch (action.type) {
      case 'add_tag':
        if (!action.params.contactId && !event.payload.contactId) {
          throw new Error('Missing contactId for add_tag action');
        }
        await ContactService.addTag(
          action.params.contactId || event.payload.contactId, 
          action.params.tagId, 
          'automation_engine'
        );
        break;

      case 'create_case':
        if (!event.payload.contactId) throw new Error('Missing contactId in event for create_case action');
        await CaseService.create({
          tenantId,
          contactId: event.payload.contactId,
          channelId: event.payload.channelId || action.params.channelId,
          title: action.params.title || 'Automated Case',
          priority: action.params.priority
        });
        break;

      case 'send_message':
        // Stub: Would integrate with InboxService / Channel Adapters
        logger.info(`[AutomationEngine] STUB: send_message to ${action.params.channelId}: ${action.params.text}`);
        break;

      default:
        logger.warn(`[AutomationEngine] Unknown action type: ${action.type}`);
    }
  }
}
