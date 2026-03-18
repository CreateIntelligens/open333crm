import { Engine } from 'json-rules-engine';

export class AutomationEngine {
  private engine: Engine;

  constructor() {
    this.engine = new Engine();
  }

  public addRule(rule: any) {
    this.engine.addRule(rule);
  }

  public async evaluate(fact: any) {
    return await this.engine.run(fact);
  }
}
