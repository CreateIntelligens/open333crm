import fs from 'node:fs/promises';
import axios from 'axios';

/**
 * Service to transcribe audio files to text using Whisper.
 * Defaults to OpenAI API but can be extended for local providers.
 */
export class WhisperService {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Transcribes an audio file to Markdown text.
   * @param audioPath Absolute path to the audio file
   * @returns Transcribed text in Markdown format
   */
  async transcribe(audioPath: string): Promise<string> {
    if (!this.apiKey) {
      // Mock for development if no API key
      return `[Transcription Mock]\nThis is a mock transcription for the audio file at ${audioPath}.`;
    }

    try {
      // Basic implementation for OpenAI Whisper API
      const formData = new FormData();
      const fileBuffer = await fs.readFile(audioPath);
      formData.append('file', new Blob([fileBuffer]), 'audio.mp3');
      formData.append('model', 'whisper-1');

      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      return `## Audio Transcription\n\n${response.data.text}`;
    } catch (error) {
      console.error('Whisper transcription failed:', error);
      throw error;
    }
  }
}
