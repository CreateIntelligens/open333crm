import axios from 'axios';

/**
 * Service to summarize conversations for long-term memory storage.
 */
export class SummarizationService {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Summarizes a list of messages into a concise paragraph.
   * @param messages Array of message content strings
   * @returns The generated summary
   */
  async summarize(messages: string[]): Promise<string> {
    if (messages.length === 0) return '';
    if (!this.apiKey) {
      // Mock for development
      const firstMsg = messages[0]?.slice(0, 50) || 'nothing';
      return `[Summary Mock] The user discussed ${messages.length} topics. Specifically mentioned: ${firstMsg}...`;
    }

    try {
      const prompt = `Summarize the following conversation into a single concise paragraph for CRM memory storage:\n\n${messages.join('\n')}`;
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('Summarization failed:', error);
      throw error;
    }
  }
}
